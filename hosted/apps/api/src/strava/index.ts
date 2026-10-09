import { and, eq, isNull, lt } from "drizzle-orm";
import { Hono } from "hono";

import type { Database } from "../db";
import { stravaConnection, stravaLink } from "../db/schema";
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

/** What the state Strava gives back says: which sign-in this is. */
type State = { link: string; expires: number };

/** SHA-256 of the app's verifier, base64url without padding. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
/** The shortest time between a rider's uploads. Strava's limits are shared by every rider. */
const MIN_UPLOAD_GAP_MS = 5000;

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

  // The app opens the address this returns in a web authentication session. It keeps the verifier
  // behind its challenge to itself until Strava's page is done.
  app.post("/connect", async (c) => {
    const keysOfApp = credentials();
    if (!keysOfApp) return c.json({ error: "strava_not_configured" }, 503);
    const body = await c.req.json().catch(() => undefined);
    const challenge = body?.code_challenge;
    if (typeof challenge !== "string" || !CHALLENGE.test(challenge)) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const userId = userIdOf(c);
    const link = crypto.randomUUID();
    const expires = nowSeconds() + STATE_LIFETIME_SECONDS;
    const database = deps.database();
    // One sign-in at a time per rider, and none left lying around.
    await database.delete(stravaLink).where(eq(stravaLink.userId, userId));
    await database.delete(stravaLink).where(lt(stravaLink.expiresAt, nowSeconds()));
    await database.insert(stravaLink).values({ id: link, userId, challenge, expiresAt: expires });
    const state: State = { link, expires };
    const redirectUri = `${new URL(c.req.url).origin}/strava/callback`;
    return c.json({
      url: strava.authorizeUrl(keysOfApp, redirectUri, await (await getVault()).sign(state)),
    });
  });

  // Strava sends the rider back here. The tokens wait for the app to collect them: a callback
  // reached some other way cannot connect anything.
  app.get("/callback", async (c) => {
    const keys = await getVault();
    const state = await keys.verify<State>(c.req.query("state") ?? "");
    if (!state || state.expires < nowSeconds()) return c.json({ error: "invalid_state" }, 400);
    const link = await deps
      .database()
      .select()
      .from(stravaLink)
      .where(eq(stravaLink.id, state.link))
      .get();
    if (!link || link.expiresAt < nowSeconds()) return c.json({ error: "invalid_state" }, 400);
    // Each sign-in is finished once.
    if (link.tokens) return c.redirect(toApp({ error: "exchange_failed" }), 302);
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
    const stored = await deps
      .database()
      .update(stravaLink)
      .set({ tokens: await keys.encrypt(JSON.stringify(await response.json())) })
      .where(and(eq(stravaLink.id, link.id), isNull(stravaLink.tokens)))
      .returning({ id: stravaLink.id });
    if (stored.length === 0) return c.redirect(toApp({ error: "exchange_failed" }), 302);
    return c.redirect(toApp({ connected: "1" }), 302);
  });

  // The app trades the verifier for the connection once the web session has ended well.
  app.post("/connect/complete", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const verifier = body?.code_verifier;
    if (typeof verifier !== "string" || !VERIFIER.test(verifier)) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const challenge = toBase64Url(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    const userId = userIdOf(c);
    const database = deps.database();
    const link = await database
      .select()
      .from(stravaLink)
      .where(and(eq(stravaLink.userId, userId), eq(stravaLink.challenge, challenge)))
      .get();
    if (!link?.tokens || link.expiresAt < nowSeconds()) {
      return c.json({ error: "invalid_link" }, 400);
    }
    const plain = await (await getVault()).decrypt(link.tokens);
    if (!plain) return c.json({ error: "invalid_link" }, 400);
    const tokens = JSON.parse(plain) as strava.TokenResponse;
    await save(userId, tokens);
    await database.delete(stravaLink).where(eq(stravaLink.id, link.id));
    return c.json(await statusOf(userId));
  });

  const statusOf = async (userId: string) => {
    const row = await connectionOf(userId);
    return row
      ? { connected: true, athleteName: row.athleteName ?? undefined }
      : { connected: false };
  };

  app.get("/", async (c) => c.json(await statusOf(userIdOf(c))));

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
    const userId = userIdOf(c);
    const row = await connectionOf(userId);
    if (!row) return c.json({ error: "not_connected" }, 409);
    if (Date.now() - (row.lastUploadAt ?? 0) < MIN_UPLOAD_GAP_MS) {
      return c.json({ error: "rate_limited" }, 429);
    }
    const fit = await readBody(c.req.raw, MAX_FIT_BYTES);
    if (!fit) return c.json({ error: "too_large" }, 413);
    if (fit.byteLength === 0) return c.json({ error: "empty" }, 400);
    await deps
      .database()
      .update(stravaConnection)
      .set({ lastUploadAt: Date.now() })
      .where(eq(stravaConnection.userId, userId));
    const name = (c.req.query("name") ?? "Ride").slice(0, 200) || "Ride";
    const fileName = (c.req.query("fileName") ?? "ride.fit")
      .replace(/[^\w. -]/g, "_")
      .slice(0, 100);
    try {
      const response = await withToken(userId, (token) =>
        strava.createUpload(
          fetcher,
          token,
          fit.buffer as ArrayBuffer,
          name,
          fileName || "ride.fit",
        ),
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

/** The request's body, or nothing if it is longer than `limit`, without reading past the limit. */
async function readBody(request: Request, limit: number): Promise<Uint8Array | undefined> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

const toBase64Url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
