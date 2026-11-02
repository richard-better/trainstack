import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { and, eq, isNotNull } from "drizzle-orm";
import type { Database } from "../db";
import * as schema from "../db/schema/auth";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";

import { APPLE_APP_BUNDLE_ID, APPLE_SERVICES_ID, revokeAppleToken } from "./apple";
import { appHandoff } from "./app-handoff";

export { APPLE_APP_BUNDLE_ID } from "./apple";

const APPLE_WEB_FLOW_RESULT_ORIGIN = "https://appleid.apple.com";
const NATIVE_SIGN_IN_AUDIENCE = APPLE_APP_BUNDLE_ID;
const WEB_FLOW_AUDIENCE = APPLE_SERVICES_ID;
const SHARED_ACROSS_ISOLATES = "database";
const CLOUDFLARE_CLIENT_ADDRESS_HEADER = "cf-connecting-ip";

function logWithoutStoppingTheDeletion(error: unknown) {
  console.error(error);
}

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
};

export function createAuth(env: AuthConfig, database: Database, appleWebFlowClientSecret?: string) {
  const bearerAfterTheHandoffHasTakenTheBrowserSession = bearer();

  async function revokeWhatAppleWebFlowGranted(userId: string) {
    if (!appleWebFlowClientSecret) return;
    const tokens = await database
      .select({ refreshToken: schema.account.refreshToken })
      .from(schema.account)
      .where(
        and(
          eq(schema.account.userId, userId),
          eq(schema.account.providerId, "apple"),
          isNotNull(schema.account.refreshToken),
        ),
      );
    for (const { refreshToken } of tokens) {
      if (!refreshToken) continue;
      await revokeAppleToken(appleWebFlowClientSecret, refreshToken).catch(
        logWithoutStoppingTheDeletion,
      );
    }
  }

  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN, APPLE_WEB_FLOW_RESULT_ORIGIN],
    emailAndPassword: { enabled: false },
    socialProviders: {
      apple: {
        clientId: APPLE_SERVICES_ID,
        clientSecret: appleWebFlowClientSecret ?? "",
        audience: [NATIVE_SIGN_IN_AUDIENCE, WEB_FLOW_AUDIENCE],
        appBundleIdentifier: APPLE_APP_BUNDLE_ID,
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => revokeWhatAppleWebFlowGranted(user.id),
      },
    },
    account: { accountLinking: { enabled: false } },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    rateLimit: { storage: SHARED_ACROSS_ISOLATES },
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
      ipAddress: { ipAddressHeaders: [CLOUDFLARE_CLIENT_ADDRESS_HEADER] },
    },
    plugins: [
      appHandoff({ database, enabled: Boolean(appleWebFlowClientSecret) }),
      bearerAfterTheHandoffHasTakenTheBrowserSession,
    ],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
