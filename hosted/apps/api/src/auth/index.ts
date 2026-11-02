import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { and, eq, isNotNull } from "drizzle-orm";
import type { Database } from "../db";
import * as schema from "../db/schema/auth";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";

import { APPLE_APP_BUNDLE_ID, APPLE_SERVICES_ID, revokeAppleToken } from "./apple";
import { appHandoff } from "./app-handoff";

export { APPLE_APP_BUNDLE_ID } from "./apple";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
};

export function createAuth(
  env: AuthConfig,
  database: Database,
  /** Signs Apple's web flow in. Without it, only the app's native Sign in with Apple works. */
  appleClientSecret?: string,
) {
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema,
    }),
    // Apple's web flow posts its result back from Apple's own origin.
    trustedOrigins: [env.CORS_ORIGIN, "https://appleid.apple.com"],
    emailAndPassword: { enabled: false },
    // The app signs in natively with the identity token Apple gives it, whose audience is the
    // bundle ID. Builds that cannot do that sign in through Apple's web flow, whose audience is
    // the Services ID. Apple gives a rider the same user ID in both, so they reach one account.
    socialProviders: {
      apple: {
        clientId: APPLE_SERVICES_ID,
        clientSecret: appleClientSecret ?? "",
        audience: [APPLE_APP_BUNDLE_ID, APPLE_SERVICES_ID],
        appBundleIdentifier: APPLE_APP_BUNDLE_ID,
      },
    },
    // The app asks to delete the rider's account, as App Review requires wherever accounts are
    // made. Rows that belong to the user go with it.
    user: {
      deleteUser: {
        enabled: true,
        // Apple asks apps to revoke what the web flow granted when the account goes.
        beforeDelete: async (user) => {
          if (!appleClientSecret) return;
          const tokens = await database
            .select({ refreshToken: schema.account.refreshToken })
            .from(schema.account)
            .where(
              and(
                eq(schema.account.userId, user.id),
                eq(schema.account.providerId, "apple"),
                isNotNull(schema.account.refreshToken),
              ),
            );
          for (const { refreshToken } of tokens) {
            if (!refreshToken) continue;
            // The account goes whatever Apple says, so a rider is never stuck with it.
            await revokeAppleToken(appleClientSecret, refreshToken).catch((error: unknown) =>
              console.error(error),
            );
          }
        },
      },
    },
    // Legacy email accounts were not verified. Apple sign-in must not join an account that
    // someone else could have registered with the rider's address.
    account: { accountLinking: { enabled: false } },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    // Kept in D1 so every isolate counts the same requests.
    rateLimit: { storage: "database" },
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
      // Cloudflare sets this to the client's address. Anyone can send X-Forwarded-For.
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    // Native apps keep the session token themselves and send it as a bearer token. The handoff
    // comes first, so its hook takes the browser's session off the response before bearer sees it.
    plugins: [appHandoff({ database, enabled: Boolean(appleClientSecret) }), bearer()],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
