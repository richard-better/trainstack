import { and, eq, isNull, lt, ne, sql } from "drizzle-orm";
import { Hono } from "hono";

import type { Database } from "../db";
import { account, stravaBudget, stravaConnection, stravaLink } from "../db/schema";
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
/**
 * Strava allows the whole app 200 requests in 15 minutes and counts them by athlete, so each
 * athlete gets a small part of that. Every request Ride makes to Strava is counted, including the
 * refresh and the retry behind a single call. Starting to connect is counted against the account,
 * and the code exchanges that follow against the app as a whole, so nobody can use up the limit
 * by making sign-ins that fail.
 */
const ATHLETE_CALLS = 30;
const USER_CONNECTS = 10;
const APP_EXCHANGES = 60;
const BUDGET_WINDOW_SECONDS = 15 * 60;

/** Signalled when Strava no longer accepts the rider's sign-in. */
class NotConnected extends Error {}

/** Signalled when the Strava athlete is already connected to a different account. */
class AthleteInUse extends Error {}

/** Signalled when a request to Strava would go over the rider's share of its limits. */
class OverBudget extends Error {}

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

  /**
   * Forgets a connection only if it still holds the refresh token the caller read. Refresh tokens
   * rotate, so a request that found its token refused may only have been slow behind another that
   * replaced it, and must not delete a connection that is fine.
   */
  const forgetIfUnchanged = async (userId: string, refreshCipher: string) => {
    const gone = await deps
      .database()
      .delete(stravaConnection)
      .where(
        and(eq(stravaConnection.userId, userId), eq(stravaConnection.refreshToken, refreshCipher)),
      )
      .returning({ userId: stravaConnection.userId });
    return gone.length > 0;
  };

  /** Keeps tokens Strava just gave in place of `refreshCipher`, unless another request got there. */
  const saveRefreshed = async (
    userId: string,
    refreshCipher: string,
    tokens: strava.TokenResponse,
  ) => {
    const keys = await getVault();
    await deps
      .database()
      .update(stravaConnection)
      .set({
        accessToken: await keys.encrypt(tokens.access_token),
        refreshToken: await keys.encrypt(tokens.refresh_token),
        expiresAt: tokens.expires_at,
      })
      .where(
        and(eq(stravaConnection.userId, userId), eq(stravaConnection.refreshToken, refreshCipher)),
      );
  };

  /**
   * Takes one call from the budget `key` if there is any left, in a single statement so that
   * requests arriving together cannot all see room that is only there for one.
   */
  const spend = async (key: string, limit: number) => {
    const now = nowSeconds();
    const stale = sql`${stravaBudget.windowStart} <= ${now - BUDGET_WINDOW_SECONDS}`;
    const spent = await deps
      .database()
      .insert(stravaBudget)
      .values({ key, windowStart: now, used: 1 })
      .onConflictDoUpdate({
        target: stravaBudget.key,
        set: {
          used: sql`CASE WHEN ${stale} THEN 1 ELSE ${stravaBudget.used} + 1 END`,
          windowStart: sql`CASE WHEN ${stale} THEN ${now} ELSE ${stravaBudget.windowStart} END`,
        },
        setWhere: sql`${stale} OR ${stravaBudget.used} < ${limit}`,
      })
      .returning({ key: stravaBudget.key });
    return spent.length > 0;
  };

  /** Whether `key` has nothing left, to turn a request away before doing work for it. */
  const isSpent = async (key: string, limit: number) => {
    const row = await deps
      .database()
      .select()
      .from(stravaBudget)
      .where(eq(stravaBudget.key, key))
      .get();
    return !!row && row.used >= limit && row.windowStart > nowSeconds() - BUDGET_WINDOW_SECONDS;
  };

  /**
   * Whether the account that holds an athlete has lost Strava's trust, which only the rider can
   * make happen, by removing Ride in their Strava settings. A holder Strava still accepts is
   * kept, so an account cannot be evicted by someone who tricked the rider into approving, and a
   * rider whose athlete was taken first can still get it back by revoking Ride. Whenever it
   * cannot be told for sure, the holder keeps it.
   */
  const holderRevoked = async (holderId: string) => {
    const keysOfApp = credentials();
    const row = await connectionOf(holderId);
    if (!row) return true;
    if (!keysOfApp) return false;
    const refreshToken = await (await getVault()).decrypt(row.refreshToken);
    if (!refreshToken) return false;
    if (!(await spend(`athlete:${row.athleteId}`, ATHLETE_CALLS))) return false;
    const response = await strava
      .refreshTokens(fetcher, keysOfApp, refreshToken)
      .catch(() => undefined);
    if (!response) return false;
    if (response.status === 400 || response.status === 401) {
      return forgetIfUnchanged(holderId, row.refreshToken);
    }
    if (response.ok) {
      await saveRefreshed(
        holderId,
        row.refreshToken,
        (await response.json()) as strava.TokenResponse,
      );
    }
    return false;
  };

  /** Connects the athlete Strava's code exchange named to the account. */
  const save = async (userId: string, tokens: strava.TokenResponse) => {
    const athlete = tokens.athlete;
    if (!athlete) throw new Error("Strava did not say which athlete agreed");
    const keys = await getVault();
    const values = {
      accessToken: await keys.encrypt(tokens.access_token),
      refreshToken: await keys.encrypt(tokens.refresh_token),
      expiresAt: tokens.expires_at,
    };
    const holder = await deps
      .database()
      .select({ userId: stravaConnection.userId })
      .from(stravaConnection)
      .where(and(eq(stravaConnection.athleteId, athlete.id), ne(stravaConnection.userId, userId)))
      .get();
    if (holder && !(await holderRevoked(holder.userId))) throw new AthleteInUse();
    const name = [athlete.firstname, athlete.lastname].filter(Boolean).join(" ") || null;
    try {
      await deps
        .database()
        .insert(stravaConnection)
        .values({ userId, athleteId: athlete.id, athleteName: name, ...values })
        .onConflictDoUpdate({
          target: stravaConnection.userId,
          set: { athleteId: athlete.id, athleteName: name, ...values },
        });
    } catch {
      // Another account got there between the check and the insert.
      throw new AthleteInUse();
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
    if (!accessToken || !(await keys.decrypt(row.refreshToken))) {
      await forgetIfUnchanged(userId, row.refreshToken);
      throw new NotConnected();
    }

    const budget = `athlete:${row.athleteId}`;
    const spendCall = async () => {
      if (!(await spend(budget, ATHLETE_CALLS))) throw new OverBudget();
    };

    // Starts from what is stored now, since another request may have refreshed since this began.
    const refresh = async () => {
      const current = await connectionOf(userId);
      const refreshToken = current && (await keys.decrypt(current.refreshToken));
      if (!current || !refreshToken) throw new NotConnected();
      await spendCall();
      const response = await strava.refreshTokens(fetcher, keysOfApp, refreshToken);
      if (response.status === 400 || response.status === 401) {
        if (await forgetIfUnchanged(userId, current.refreshToken)) throw new NotConnected();
        // Another request replaced the tokens first, so Strava refused the old ones.
        const latest = await connectionOf(userId);
        const token = latest && (await keys.decrypt(latest.accessToken));
        if (!token) throw new NotConnected();
        return token;
      }
      if (!response.ok) throw new Error(`Strava refresh answered ${response.status}`);
      const tokens = (await response.json()) as strava.TokenResponse;
      await saveRefreshed(userId, current.refreshToken, tokens);
      return tokens.access_token;
    };

    if (row.expiresAt - nowSeconds() <= 60) accessToken = await refresh();
    await spendCall();
    const response = await call(accessToken);
    if (response.status !== 401) return response;
    const refreshed = await refresh();
    await spendCall();
    return call(refreshed);
  };

  const failure = (
    error: unknown,
    c: { json: (body: object, status: 409 | 429 | 502) => Response },
  ) =>
    error instanceof NotConnected
      ? c.json({ error: "not_connected" }, 409)
      : error instanceof OverBudget
        ? c.json({ error: "rate_limited" }, 429)
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
    // Legacy email-only accounts cannot spend Strava's shared sign-in budget.
    const apple = await deps
      .database()
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "apple")))
      .get();
    if (!apple) return c.json({ error: "apple_account_required" }, 403);
    if (!(await spend(`user:${userId}`, USER_CONNECTS))) {
      return c.json({ error: "rate_limited" }, 429);
    }
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
    // Each sign-in gets one try, whatever Strava's page sent back, so a state cannot be used to
    // make Strava turn down code after code.
    const claimed = await deps
      .database()
      .update(stravaLink)
      .set({ tokens: "pending" })
      .where(and(eq(stravaLink.id, link.id), isNull(stravaLink.tokens)))
      .returning({ id: stravaLink.id });
    if (claimed.length === 0) return c.redirect(toApp({ error: "exchange_failed" }), 302);
    const end = async (error: string) => {
      await deps.database().delete(stravaLink).where(eq(stravaLink.id, link.id));
      return c.redirect(toApp({ error }), 302);
    };

    const keysOfApp = credentials();
    if (!keysOfApp) return end("strava_not_configured");
    const code = c.req.query("code");
    if (c.req.query("error") || !code) return end("access_denied");
    // Strava lets the rider untick what they grant, and Ride cannot upload without this.
    if (!(c.req.query("scope") ?? "").split(",").includes("activity:write")) {
      return end("insufficient_scope");
    }
    if (!(await spend("app:exchange", APP_EXCHANGES))) return end("exchange_failed");
    const response = await strava.exchangeCode(fetcher, keysOfApp, code);
    if (!response.ok) return end("exchange_failed");
    await deps
      .database()
      .update(stravaLink)
      .set({ tokens: await keys.encrypt(JSON.stringify(await response.json())) })
      .where(eq(stravaLink.id, link.id));
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
    try {
      await save(userId, tokens);
    } catch (error) {
      if (!(error instanceof AthleteInUse)) throw error;
      await database.delete(stravaLink).where(eq(stravaLink.id, link.id));
      return c.json({ error: "athlete_in_use" }, 409);
    }
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
      if (accessToken && (await spend(`athlete:${row.athleteId}`, ATHLETE_CALLS))) {
        await strava.deauthorize(fetcher, accessToken).catch(() => undefined);
      }
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
    // Counted properly when Strava is called; this saves reading a ride for a rider who is out.
    const row = await connectionOf(userId);
    if (!row) return c.json({ error: "not_connected" }, 409);
    if (await isSpent(`athlete:${row.athleteId}`, ATHLETE_CALLS)) {
      return c.json({ error: "rate_limited" }, 429);
    }
    const fit = await readBody(c.req.raw, MAX_FIT_BYTES);
    if (!fit) return c.json({ error: "too_large" }, 413);
    if (fit.byteLength === 0) return c.json({ error: "empty" }, 400);
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
