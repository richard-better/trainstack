import { bearer } from "better-auth/plugins";
import { env } from "@trainstack/prehab-env/server";
import { and, eq, isNotNull } from "drizzle-orm";

import { createDb } from "../db";
import * as schema from "../db/schema/auth";
import { emitEvent } from "../events/emit";
import { DomainEvents } from "../events/types";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export function createAuth() {
  const db = createDb();

  const appleConfigured = Boolean(
    env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET && env.APPLE_APP_BUNDLE_IDENTIFIER,
  );

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: schema,
    }),
    trustedOrigins: [
      env.CORS_ORIGIN,
      "pre://",
      ...(appleConfigured ? ["https://appleid.apple.com"] : []),
      ...(env.NODE_ENV === "development"
        ? ["exp://", "exp://**", "exp://192.168.*.*:*/**", "http://localhost:8081"]
        : []),
    ],
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: appleConfigured
      ? {
          apple: {
            clientId: env.APPLE_CLIENT_ID!,
            clientSecret: env.APPLE_CLIENT_SECRET!,
            appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER!,
          },
        }
      : {},
    databaseHooks: {
      session: {
        create: {
          // Signing in is how a user cancels a scheduled deletion (PRE-99).
          // On every new session, clear the marker if it was set and email a
          // reactivation confirmation. The WHERE only matches accounts pending
          // deletion, so this is a no-op write for ordinary sign-ins.
          after: async (newSession) => {
            const [reactivated] = await db
              .update(schema.user)
              .set({ deletionScheduledAt: null })
              .where(
                and(
                  eq(schema.user.id, newSession.userId),
                  isNotNull(schema.user.deletionScheduledAt),
                ),
              )
              .returning({ email: schema.user.email, name: schema.user.name });

            if (reactivated) {
              await emitEvent(DomainEvents.ACCOUNT_REACTIVATED, {
                email: reactivated.email,
                name: reactivated.name,
              });
            }
          },
        },
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: env.NODE_ENV === "production",
        httpOnly: true,
      },
    },
    plugins: [bearer()],
  });
}

export const auth = createAuth();
