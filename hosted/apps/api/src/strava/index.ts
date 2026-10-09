import { eq } from "drizzle-orm";
import { Hono } from "hono";

import type { Database } from "../db";
import { stravaConnection } from "../db/schema";
import * as strava from "./api";
import { createVault, type Vault } from "./crypto";

export type StravaDeps = {
  env: {
    STRAVA_CLIENT_ID?: string;
    STRAVA_CLIENT_SECRET?: string;
    BETTER_AUTH_SECRET: string;
  };
  database: () => Database;
  /** The signed-in rider's ID, if the request carries a session. */
  userId: (request: Request) => Promise<string | undefined>;
  fetcher?: typeof fetch;
};

/** Where the rider is sent once Strava is connected, or not, for the app to pick up. */
const APP_REDIRECT = "trainstackride://strava";
/** How long a rider has to finish signing in on Strava's page. */
const STATE_LIFETIME_SECONDS = 600;
const MAX_FIT_BYTES = 10 * 1024 * 1024;

type State = { user: string; expires: number };

/** Signalled when Strava no longer accepts the rider's sign-in. */
class NotConnected extends Error {}

/**
 * Connects riders to Strava and uploads their rides for them. Tokens live encrypted in the
 * database and never reach a device. The app asks for everything with the rider's session token.
 */
export function stravaRoutes(deps: StravaDeps) {
  const app = new Hono();
  const fetcher = deps.fetcher ?? fetch;
  let vault: Promise<Vault> | undefined;
  const getVault = () => (vault ??= createVault(deps.env.BETTER_AUTH_SECRET));

  const credentials = (): strava.StravaCredentials | undefined =>
    deps.env.STRAVA_CLIENT_ID && deps.env.STRAVA_CLIENT_SECRET
      ? { id: deps.env.STRAVA_CLIENT_ID, secret: deps.env.STRAVA_CLIENT_SECRET }
      : undefined;

  const toApp = (params: Record<string, string>) => {
    const url = new URL(APP_REDIRECT);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  };

  const nowSeconds = () => Math.floor(Date.now() / 1000);

  const connectionOf = (userId: string) =>
    deps
      .database()
      .select()
      .from(stravaConnection)
      .where(eq(stravaConnection.userId, userId))
      .get();

  const forget = (userId: string) =>
    deps.database().delete(stravaConnection).where(eq(stravaConnection.userId, userId));

  const save = async (
    userId: string,
    tokens: strava.TokenResponse,
    athleteName?: string | null,
  ) => {
    const keys = await getVault();
    const values = {
      accessToken: await keys.encrypt(tokens.access_token),
      refreshToken: await keys.encrypt(tokens.refresh_token),
      expiresAt: tokens.expires_at,
    };
    if (tokens.athlete) {
      const name = [tokens.athlete.firstname, tokens.athlete.lastname].filter(Boolean).join(" ");
      await deps
        .database()
        .insert(stravaConnection)
        .values({ userId, athleteId: tokens.athlete.id, athleteName: name || null, ...values })
        .onConflictDoUpdate({
          target: stravaConnection.userId,
          set: { athleteId: tokens.athlete.id, athleteName: name || null, ...values },
        });
    } else {
      // A refresh does not say who the athlete is, and nothing about them has changed.
      await deps
        .database()
        .update(stravaConnection)
        .set({ ...values, ...(athleteName === undefined ? {} : { athleteName }) })
        .where(eq(stravaConnection.userId, userId));
    }
  };

  /**
   * Runs `call` with the rider's access token, refreshing it first if it is about to run out and
   * once more if Strava turns it down. A sign-in Strava has revoked is forgotten.
   */
  const withToken = async (
    userId: string,
    call: (accessToken: string) => Promise<Response>,
  ): Promise<Response> => {
    const keys = await getVault();
    const keysOfApp = credentials();
    const row = await connectionOf(userId);
    if (!row || !keysOfApp) throw new NotConnected();

    let accessToken = await keys.decrypt(row.accessToken);
    const refreshToken = await keys.decrypt(row.refreshToken);
    if (!accessToken || !refreshToken) {
      await forget(userId);
      throw new NotConnected();
    }

    const refresh = async () => {
      const response = await strava.refreshTokens(fetcher, keysOfApp, refreshToken);
      if (response.status === 400 || response.status === 401) {
        await forget(userId);
        throw new NotConnected();
      }
      if (!response.ok) throw new Error(`Strava refresh answered ${response.status}`);
      const tokens = (await response.json()) as strava.TokenResponse;
      await save(userId, tokens);
      return tokens.access_token;
    };

    if (row.expiresAt - nowSeconds() <= 60) accessToken = await refresh();
    const response = await call(accessToken);
    if (response.status !== 401) return response;
    return call(await refresh());
  };

  const failure = (error: unknown, c: { json: (body: object, status: 409 | 502) => Response }) =>
    error instanceof NotConnected
      ? c.json({ error: "not_connected" }, 409)
      : c.json({ error: "strava_unavailable" }, 502);

  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
  });

  // Everything but the callback, which Strava's page calls, is for a signed-in rider.
  app.use("*", async (c, next) => {
    if (c.req.path === "/strava/callback") return next();
    const userId = await deps.userId(c.req.raw);
    if (!userId) return c.json({ error: "unauthorized" }, 401);
    c.set("userId" as never, userId as never);
    return next();
  });

  const userIdOf = (c: { get: (key: never) => unknown }) => c.get("userId" as never) as string;

  // The app opens the address this returns in a web authentication session.
  app.post("/connect", async (c) => {
    const keysOfApp = credentials();
    if (!keysOfApp) return c.json({ error: "strava_not_configured" }, 503);
    const state: State = { user: userIdOf(c), expires: nowSeconds() + STATE_LIFETIME_SECONDS };
    const redirectUri = `${new URL(c.req.url).origin}/strava/callback`;
    return c.json({
      url: strava.authorizeUrl(keysOfApp, redirectUri, await (await getVault()).sign(state)),
    });
  });

  // Strava sends the rider back here; the signed state says whose Strava this is.
  app.get("/callback", async (c) => {
    const state = await (await getVault()).verify<State>(c.req.query("state") ?? "");
    if (!state || state.expires < nowSeconds()) return c.json({ error: "invalid_state" }, 400);
    const keysOfApp = credentials();
    if (!keysOfApp) return c.redirect(toApp({ error: "strava_not_configured" }), 302);

    const code = c.req.query("code");
    if (c.req.query("error") || !code) return c.redirect(toApp({ error: "access_denied" }), 302);
    // Strava lets the rider untick what they grant, and Ride cannot upload without this.
    if (!(c.req.query("scope") ?? "").split(",").includes("activity:write")) {
      return c.redirect(toApp({ error: "insufficient_scope" }), 302);
    }
    const response = await strava.exchangeCode(fetcher, keysOfApp, code);
    if (!response.ok) return c.redirect(toApp({ error: "exchange_failed" }), 302);
    try {
      await save(state.user, (await response.json()) as strava.TokenResponse);
    } catch {
      // The rider deleted their account while signing in to Strava.
      return c.redirect(toApp({ error: "exchange_failed" }), 302);
    }
    return c.redirect(toApp({ connected: "1" }), 302);
  });

  app.get("/", async (c) => {
    const row = await connectionOf(userIdOf(c));
    return c.json(
      row ? { connected: true, athleteName: row.athleteName ?? undefined } : { connected: false },
    );
  });

  app.delete("/", async (c) => {
    const userId = userIdOf(c);
    const row = await connectionOf(userId);
    if (row) {
      // Tell Strava too, so Ride disappears from the rider's connected apps. If the token has
      // run out or Strava is down, the rider can still remove Ride in Strava's settings.
      const accessToken = await (await getVault()).decrypt(row.accessToken);
      if (accessToken) await strava.deauthorize(fetcher, accessToken).catch(() => undefined);
      await forget(userId);
    }
    return c.body(null, 204);
  });

  // The ride's FIT file is the body. Strava takes a while to make an activity of it, so this
  // returns as soon as Strava has the file and the app asks after it.
  app.post("/uploads", async (c) => {
    if (Number(c.req.header("content-length") ?? 0) > MAX_FIT_BYTES) {
      return c.json({ error: "too_large" }, 413);
    }
    const fit = await c.req.arrayBuffer();
    if (fit.byteLength === 0) return c.json({ error: "empty" }, 400);
    if (fit.byteLength > MAX_FIT_BYTES) return c.json({ error: "too_large" }, 413);
    const name = (c.req.query("name") ?? "Ride").slice(0, 200) || "Ride";
    const fileName = (c.req.query("fileName") ?? "ride.fit")
      .replace(/[^\w. -]/g, "_")
      .slice(0, 100);
    try {
      const response = await withToken(userIdOf(c), (token) =>
        strava.createUpload(fetcher, token, fit, name, fileName || "ride.fit"),
      );
      if (response.status === 429) return c.json({ error: "rate_limited" }, 429);
      if (!response.ok && response.status !== 400)
        throw new Error(`Strava answered ${response.status}`);
      return c.json(shape(await response.json()), response.status === 400 ? 400 : 202);
    } catch (error) {
      return failure(error, c);
    }
  });

  app.get("/uploads/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: "invalid_request" }, 400);
    try {
      const response = await withToken(userIdOf(c), (token) =>
        strava.getUpload(fetcher, token, id),
      );
      if (response.status === 429) return c.json({ error: "rate_limited" }, 429);
      if (!response.ok) throw new Error(`Strava answered ${response.status}`);
      return c.json(shape(await response.json()));
    } catch (error) {
      return failure(error, c);
    }
  });

  return app;
}

type StravaUpload = { id?: number; error?: string | null; activity_id?: number | null };

/** What the app needs to know about an upload: working, done with an activity, or turned down. */
function shape(upload: StravaUpload) {
  const id = upload.id;
  if (upload.error) {
    const duplicate = /duplicate of activity (\d+)/i.exec(upload.error);
    return {
      id,
      status: "error",
      error: upload.error,
      ...(duplicate ? { duplicateOf: Number(duplicate[1]) } : {}),
    };
  }
  if (upload.activity_id) return { id, status: "ready", activityId: upload.activity_id };
  return { id, status: "processing" };
}
