import { and, eq, isNull, lt, ne, sql } from "drizzle-orm";
import { Hono } from "hono";

import type { Database } from "../db";
import { stravaBudget, stravaConnection, stravaLink } from "../db/schema";
import { hasAppleAccount, requireRider, riderId, type RiderOf } from "../rider";
import * as strava from "./api";
import { createVault, type Encrypted, type Vault } from "./crypto";

export type StravaDeps = {
  env: {
    STRAVA_CLIENT_ID?: string;
    STRAVA_CLIENT_SECRET?: string;
    BETTER_AUTH_SECRET: string;
  };
  database: () => Database;
  userId: RiderOf;
  fetcher?: typeof fetch;
};

const APP_REDIRECT = "trainstackride://strava";
const SIGN_IN_LIFETIME_SECONDS = 600;
const MAX_FIT_BYTES = 10 * 1024 * 1024;
const REFRESH_WHEN_SECONDS_LEFT = 60;
const PENDING_EXCHANGE = "pending";

type SignInState = { link: string; expires: number };

const SHA256_BASE64URL = /^[A-Za-z0-9_-]{43}$/;
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const STRAVA_DUPLICATE_UPLOAD = /duplicate of activity (\d+)/i;

const CALLS_PER_ATHLETE = 30;
const CONNECT_STARTS_PER_ACCOUNT = 10;
const CODE_EXCHANGES_PER_APP = 60;
export const BUDGET_WINDOW_SECONDS = 15 * 60;

export const budgetOf = {
  athlete: (athleteId: number) => `athlete:${athleteId}`,
  connectStarts: (userId: string) => `user:${userId}`,
  codeExchanges: "app:exchange",
};

const isCallbackFromStravasPage = (path: string) => path === "/strava/callback";

const stravaRefusedTokens = (response: Response) =>
  response.status === 400 || response.status === 401;

class NotConnected extends Error {}

class AthleteInUse extends Error {}

class OverBudget extends Error {}

async function spendBudget(database: Database, key: string, limit: number) {
  const now = Math.floor(Date.now() / 1000);
  const stale = sql`${stravaBudget.windowStart} <= ${now - BUDGET_WINDOW_SECONDS}`;
  const spent = await database
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
}

export type StravaDisconnectDeps = {
  database: Database;
  vault: Vault;
  fetcher: typeof fetch;
  credentials: strava.StravaCredentials | undefined;
  budget: "spend" | "ignore";
};

export async function disconnectStrava(deps: StravaDisconnectDeps, userId: string) {
  const row = await deps.database
    .select()
    .from(stravaConnection)
    .where(eq(stravaConnection.userId, userId))
    .get();
  if (!row) return undefined;
  const mayCall = async () =>
    deps.budget === "ignore" ||
    spendBudget(deps.database, budgetOf.athlete(row.athleteId), CALLS_PER_ATHLETE);
  const tellStrava = async () => {
    let accessToken = await deps.vault.decrypt(row.accessToken);
    const refreshToken = await deps.vault.decrypt(row.refreshToken);
    const expired = row.expiresAt - Math.floor(Date.now() / 1000) <= REFRESH_WHEN_SECONDS_LEFT;
    if (expired && deps.credentials && refreshToken && (await mayCall())) {
      const refreshed = await strava
        .refreshTokens(deps.fetcher, deps.credentials, refreshToken)
        .catch((error: unknown) => error);
      if (refreshed instanceof Response && refreshed.ok) {
        accessToken = ((await refreshed.json()) as strava.TokenResponse).access_token;
      } else {
        console.error("Strava did not refresh before deauthorizing; trying the stored token");
      }
    }
    if (!accessToken || !(await mayCall())) return;
    const response = await strava.deauthorize(deps.fetcher, accessToken);
    if (!response.ok) throw new Error(`Strava refused to deauthorize: ${response.status}`);
  };
  await tellStrava().catch((error: unknown) => console.error(error));
  await deps.database.delete(stravaConnection).where(eq(stravaConnection.userId, userId));
  return row.athleteId;
}

async function deauthorizeUnlessConnected(
  deps: Pick<StravaDisconnectDeps, "database" | "fetcher">,
  tokens: strava.TokenResponse,
  spare: { anyAccount: true } | { accountsOtherThan: string },
) {
  if (tokens.athlete) {
    const connected = await deps.database
      .select({ userId: stravaConnection.userId })
      .from(stravaConnection)
      .where(
        "anyAccount" in spare
          ? eq(stravaConnection.athleteId, tokens.athlete.id)
          : and(
              eq(stravaConnection.athleteId, tokens.athlete.id),
              ne(stravaConnection.userId, spare.accountsOtherThan),
            ),
      )
      .get();
    if (connected) return;
  }
  const response = await strava
    .deauthorize(deps.fetcher, tokens.access_token)
    .catch((error: unknown) => error);
  if (!(response instanceof Response && response.ok)) {
    console.error("Strava did not deauthorize an unfinished sign-in", response);
  }
}

export async function deauthorizeUnfinishedSignIns(
  deps: Pick<StravaDisconnectDeps, "database" | "vault" | "fetcher">,
  userId: string,
) {
  const links = await deps.database
    .delete(stravaLink)
    .where(eq(stravaLink.userId, userId))
    .returning({ tokens: stravaLink.tokens });
  for (const { tokens } of links) {
    if (!tokens || tokens === PENDING_EXCHANGE) continue;
    const plain = await deps.vault.decrypt(tokens);
    if (!plain) continue;
    await deauthorizeUnlessConnected(deps, JSON.parse(plain) as strava.TokenResponse, {
      accountsOtherThan: userId,
    });
  }
}

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

  const cancelSignInsOf = (userId: string) =>
    deps.database().delete(stravaLink).where(eq(stravaLink.userId, userId));

  const forgetExpiredSignIns = () =>
    deps.database().delete(stravaLink).where(lt(stravaLink.expiresAt, nowSeconds()));

  const forgetIfUnchanged = async (userId: string, refreshCipher: Encrypted) => {
    const gone = await deps
      .database()
      .delete(stravaConnection)
      .where(
        and(eq(stravaConnection.userId, userId), eq(stravaConnection.refreshToken, refreshCipher)),
      )
      .returning({ userId: stravaConnection.userId });
    return gone.length > 0;
  };

  const saveRefreshedIfUnchanged = async (
    userId: string,
    refreshCipher: Encrypted,
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

  const spend = (key: string, limit: number) => spendBudget(deps.database(), key, limit);

  const isSpent = async (key: string, limit: number) => {
    const row = await deps
      .database()
      .select()
      .from(stravaBudget)
      .where(eq(stravaBudget.key, key))
      .get();
    return !!row && row.used >= limit && row.windowStart > nowSeconds() - BUDGET_WINDOW_SECONDS;
  };

  const holderRevokedRide = async (holderId: string) => {
    const keysOfApp = credentials();
    const row = await connectionOf(holderId);
    if (!row) return true;
    if (!keysOfApp) return false;
    const refreshToken = await (await getVault()).decrypt(row.refreshToken);
    if (!refreshToken) return false;
    if (!(await spend(budgetOf.athlete(row.athleteId), CALLS_PER_ATHLETE))) return false;
    const response = await strava
      .refreshTokens(fetcher, keysOfApp, refreshToken)
      .catch(() => undefined);
    if (!response) return false;
    if (stravaRefusedTokens(response)) return forgetIfUnchanged(holderId, row.refreshToken);
    if (response.ok) {
      await saveRefreshedIfUnchanged(
        holderId,
        row.refreshToken,
        (await response.json()) as strava.TokenResponse,
      );
    }
    return false;
  };

  const connectAthlete = async (userId: string, tokens: strava.TokenResponse) => {
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
    if (holder && !(await holderRevokedRide(holder.userId))) throw new AthleteInUse();
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
    } catch (athleteTakenSinceTheCheck) {
      throw new AthleteInUse(undefined, { cause: athleteTakenSinceTheCheck });
    }
  };

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

    const budget = budgetOf.athlete(row.athleteId);
    const spendCall = async () => {
      if (!(await spend(budget, CALLS_PER_ATHLETE))) throw new OverBudget();
    };

    const accessTokenStoredByAnotherRequest = async () => {
      const latest = await connectionOf(userId);
      const token = latest && (await keys.decrypt(latest.accessToken));
      if (!token) throw new NotConnected();
      return token;
    };

    const refreshTheStoredTokens = async () => {
      const current = await connectionOf(userId);
      const refreshToken = current && (await keys.decrypt(current.refreshToken));
      if (!current || !refreshToken) throw new NotConnected();
      await spendCall();
      const response = await strava.refreshTokens(fetcher, keysOfApp, refreshToken);
      if (stravaRefusedTokens(response)) {
        if (await forgetIfUnchanged(userId, current.refreshToken)) throw new NotConnected();
        return accessTokenStoredByAnotherRequest();
      }
      if (!response.ok) throw new Error(`Strava refresh answered ${response.status}`);
      const tokens = (await response.json()) as strava.TokenResponse;
      await saveRefreshedIfUnchanged(userId, current.refreshToken, tokens);
      return tokens.access_token;
    };

    if (row.expiresAt - nowSeconds() <= REFRESH_WHEN_SECONDS_LEFT) {
      accessToken = await refreshTheStoredTokens();
    }
    await spendCall();
    const response = await call(accessToken);
    if (response.status !== 401) return response;
    const refreshed = await refreshTheStoredTokens();
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

  app.use("*", requireRider(deps.userId, isCallbackFromStravasPage));

  app.post("/connect", async (c) => {
    const keysOfApp = credentials();
    if (!keysOfApp) return c.json({ error: "strava_not_configured" }, 503);
    const body = await c.req.json().catch(() => undefined);
    const challenge = body?.code_challenge;
    if (typeof challenge !== "string" || !SHA256_BASE64URL.test(challenge)) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const userId = riderId(c);
    if (!(await hasAppleAccount(deps.database(), userId))) {
      return c.json({ error: "apple_account_required" }, 403);
    }
    if (!(await spend(budgetOf.connectStarts(userId), CONNECT_STARTS_PER_ACCOUNT))) {
      return c.json({ error: "rate_limited" }, 429);
    }
    const link = crypto.randomUUID();
    const expires = nowSeconds() + SIGN_IN_LIFETIME_SECONDS;
    await cancelSignInsOf(userId);
    await forgetExpiredSignIns();
    await deps
      .database()
      .insert(stravaLink)
      .values({ id: link, userId, challenge, expiresAt: expires });
    const state: SignInState = { link, expires };
    const redirectUri = `${new URL(c.req.url).origin}/strava/callback`;
    return c.json({
      url: strava.authorizeUrl(keysOfApp, redirectUri, await (await getVault()).sign(state)),
    });
  });

  app.get("/callback", async (c) => {
    const keys = await getVault();
    const state = await keys.verify<SignInState>(c.req.query("state") ?? "");
    if (!state || state.expires < nowSeconds()) return c.json({ error: "invalid_state" }, 400);
    const link = await deps
      .database()
      .select()
      .from(stravaLink)
      .where(eq(stravaLink.id, state.link))
      .get();
    if (!link || link.expiresAt < nowSeconds()) return c.json({ error: "invalid_state" }, 400);
    const theOneTry = await deps
      .database()
      .update(stravaLink)
      .set({ tokens: PENDING_EXCHANGE })
      .where(and(eq(stravaLink.id, link.id), isNull(stravaLink.tokens)))
      .returning({ id: stravaLink.id });
    if (theOneTry.length === 0) return c.redirect(toApp({ error: "exchange_failed" }), 302);
    const end = async (error: string) => {
      await deps.database().delete(stravaLink).where(eq(stravaLink.id, link.id));
      return c.redirect(toApp({ error }), 302);
    };

    const keysOfApp = credentials();
    if (!keysOfApp) return end("strava_not_configured");
    const code = c.req.query("code");
    if (c.req.query("error") || !code) return end("access_denied");
    const grantedScopes = (c.req.query("scope") ?? "").split(",");
    if (!grantedScopes.includes(strava.UPLOAD_SCOPE)) {
      return end("insufficient_scope");
    }
    if (!(await spend(budgetOf.codeExchanges, CODE_EXCHANGES_PER_APP)))
      return end("exchange_failed");
    const response = await strava.exchangeCode(fetcher, keysOfApp, code);
    if (!response.ok) return end("exchange_failed");
    const tokens = (await response.json()) as strava.TokenResponse;
    const kept = await deps
      .database()
      .update(stravaLink)
      .set({ tokens: await keys.encrypt(JSON.stringify(tokens)) })
      .where(eq(stravaLink.id, link.id))
      .returning({ id: stravaLink.id });
    if (kept.length === 0) {
      await deauthorizeUnlessConnected({ database: deps.database(), fetcher }, tokens, {
        anyAccount: true,
      });
      return c.redirect(toApp({ error: "exchange_failed" }), 302);
    }
    return c.redirect(toApp({ connected: "1" }), 302);
  });

  app.post("/connect/complete", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const verifier = body?.code_verifier;
    if (typeof verifier !== "string" || !PKCE_VERIFIER.test(verifier)) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const challenge = toBase64Url(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    const userId = riderId(c);
    const database = deps.database();
    const link = await database
      .select()
      .from(stravaLink)
      .where(and(eq(stravaLink.userId, userId), eq(stravaLink.challenge, challenge)))
      .get();
    if (!link?.tokens || link.tokens === PENDING_EXCHANGE || link.expiresAt < nowSeconds()) {
      return c.json({ error: "invalid_link" }, 400);
    }
    const plain = await (await getVault()).decrypt(link.tokens);
    if (!plain) return c.json({ error: "invalid_link" }, 400);
    const tokens = JSON.parse(plain) as strava.TokenResponse;
    try {
      await connectAthlete(userId, tokens);
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

  app.get("/", async (c) => c.json(await statusOf(riderId(c))));

  app.delete("/", async (c) => {
    await disconnectStrava(
      {
        database: deps.database(),
        vault: await getVault(),
        fetcher,
        credentials: credentials(),
        budget: "spend",
      },
      riderId(c),
    );
    return c.body(null, 204);
  });

  app.post("/uploads", async (c) => {
    if (Number(c.req.header("content-length") ?? 0) > MAX_FIT_BYTES) {
      return c.json({ error: "too_large" }, 413);
    }
    const userId = riderId(c);
    const row = await connectionOf(userId);
    if (!row) return c.json({ error: "not_connected" }, 409);
    if (await isSpent(budgetOf.athlete(row.athleteId), CALLS_PER_ATHLETE)) {
      return c.json({ error: "rate_limited" }, 429);
    }
    const fit = await readBodyUpTo(c.req.raw, MAX_FIT_BYTES);
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
      return c.json(uploadStatus(await response.json()), response.status === 400 ? 400 : 202);
    } catch (error) {
      return failure(error, c);
    }
  });

  app.get("/uploads/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: "invalid_request" }, 400);
    try {
      const response = await withToken(riderId(c), (token) => strava.getUpload(fetcher, token, id));
      if (response.status === 429) return c.json({ error: "rate_limited" }, 429);
      if (!response.ok) throw new Error(`Strava answered ${response.status}`);
      return c.json(uploadStatus(await response.json()));
    } catch (error) {
      return failure(error, c);
    }
  });

  return app;
}

type StravaUpload = { id?: number; error?: string | null; activity_id?: number | null };

function uploadStatus(upload: StravaUpload) {
  const id = upload.id;
  if (upload.error) {
    const duplicate = STRAVA_DUPLICATE_UPLOAD.exec(upload.error);
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

async function readBodyUpTo(request: Request, limit: number): Promise<Uint8Array | undefined> {
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
