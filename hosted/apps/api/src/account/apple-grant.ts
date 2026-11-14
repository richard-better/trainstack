import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import {
  APPLE_APP_BUNDLE_ID,
  appleClientSecret,
  type AppleWebConfig,
  exchangeAppAuthorizationCode,
  revokeAppleToken,
} from "../auth/apple";
import type { Database } from "../db";
import { account, appleAppGrant } from "../db/schema";
import { requireRider, riderId, type RiderOf } from "../rider";
import { createVault } from "../strava/crypto";

export type AppleGrantEnv = AppleWebConfig & { BETTER_AUTH_SECRET: string };

export type AppleGrantDeps = {
  env: AppleGrantEnv;
  database: () => Database;
  userId: RiderOf;
  fetcher?: typeof fetch;
};

const AUTHORIZATION_CODE = /^[\w.-]{1,512}$/;

const appSecretOf = (env: AppleWebConfig) => appleClientSecret(env, APPLE_APP_BUNDLE_ID);

async function appleSubjectOf(database: Database, userId: string) {
  const row = await database
    .select({ subject: account.accountId })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "apple")))
    .get();
  return row?.subject;
}

export function appleGrantRoutes(deps: AppleGrantDeps) {
  const app = new Hono();
  const fetcher = deps.fetcher ?? fetch;

  app.use("/apple-authorization", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
  app.use("/apple-authorization", requireRider(deps.userId));

  app.post("/apple-authorization", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const code = body?.authorization_code;
    if (typeof code !== "string" || !AUTHORIZATION_CODE.test(code)) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const userId = riderId(c);
    const database = deps.database();
    const subject = await appleSubjectOf(database, userId);
    if (!subject) return c.json({ error: "apple_account_required" }, 403);
    const secret = await appSecretOf(deps.env);
    if (!secret) return c.json({ error: "apple_not_configured" }, 503);
    let tokens;
    try {
      tokens = await exchangeAppAuthorizationCode(secret, code, fetcher);
    } catch (error) {
      console.error(error);
      return c.json({ error: "apple_unavailable" }, 502);
    }
    if (tokens === "refused") return c.json({ error: "invalid_code" }, 400);
    if (tokens.subject !== subject) return c.json({ error: "another_apple_id" }, 409);
    const refreshToken = await (
      await createVault(deps.env.BETTER_AUTH_SECRET)
    ).encrypt(tokens.refreshToken);
    await database
      .insert(appleAppGrant)
      .values({ userId, refreshToken, grantedAt: new Date() })
      .onConflictDoUpdate({
        target: appleAppGrant.userId,
        set: { refreshToken, grantedAt: new Date() },
      });
    return c.body(null, 204);
  });

  return app;
}

export async function revokeWhatRideGranted(
  database: Database,
  env: AppleGrantEnv,
  userId: string,
  fetcher: typeof fetch = fetch,
) {
  const grant = await database
    .select({ refreshToken: appleAppGrant.refreshToken })
    .from(appleAppGrant)
    .where(eq(appleAppGrant.userId, userId))
    .get();
  if (!grant) return;
  const refreshToken = await (
    await createVault(env.BETTER_AUTH_SECRET)
  ).decrypt(grant.refreshToken);
  const secret = await appSecretOf(env);
  if (!refreshToken || !secret) {
    console.error("Ride's Apple grant could not be revoked: no key, or an unreadable token");
    return;
  }
  await revokeAppleToken(secret, refreshToken, fetcher, APPLE_APP_BUNDLE_ID);
}
