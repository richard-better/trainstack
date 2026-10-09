import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { Database } from "../db";
import * as schema from "../db/schema/auth";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";

/** The Ride app's bundle ID, which Apple puts in the identity token as its audience. */
export const APPLE_APP_BUNDLE_ID = "com.trainstackhq.ride";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
};

export function createAuth(
  env: AuthConfig,
  database: Database,
  desktopOrigins: readonly string[] = [],
) {
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN, ...desktopOrigins],
    emailAndPassword: { enabled: true },
    // The Ride app signs in with the identity token Apple gives it, which only needs the bundle
    // ID to check. The web flow would need a Services ID and key, which are not set up.
    socialProviders: {
      apple: { clientId: APPLE_APP_BUNDLE_ID, appBundleIdentifier: APPLE_APP_BUNDLE_ID },
    },
    // The app asks to delete the rider's account, as App Review requires wherever accounts are
    // made. Rows that belong to the user go with it.
    user: { deleteUser: { enabled: true } },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
    },
    // Native apps keep the session token themselves and send it as a bearer token.
    plugins: [bearer()],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
