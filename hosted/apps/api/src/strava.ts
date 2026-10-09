import { Hono } from "hono";

export type StravaConfig = {
  STRAVA_CLIENT_ID?: string;
  STRAVA_CLIENT_SECRET?: string;
};

/** Where a finished sign-in is handed back to the Ride app. */
const APP_REDIRECT = "trainstackride://strava";
const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
/** Uploading a ride is all Ride does with Strava. */
const SCOPE = "activity:write";
/** The app makes this up per sign-in and checks it comes back, so a stray redirect is ignored. */
const STATE = /^[A-Za-z0-9_-]{16,64}$/;
/** SHA-256 of the app's secret verifier, base64url without padding. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
/** How long the app has to redeem the ticket after Strava sends the rider back. */
const TICKET_LIFETIME_SECONDS = 300;

const encoder = new TextEncoder();

const toBase64Url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

/** An AES key derived from the client secret, so tickets need no secret of their own. */
async function ticketKey(secret: string) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(),
      info: encoder.encode("trainstack-strava-ticket"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

type Ticket = { challenge: string; expires: number; tokens: Redeemed };
type Redeemed = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete_name?: string;
};

async function seal(secret: string, ticket: Ticket) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await ticketKey(secret),
    encoder.encode(JSON.stringify(ticket)),
  );
  return toBase64Url(new Uint8Array([...iv, ...new Uint8Array(sealed)]));
}

async function open(secret: string, text: string): Promise<Ticket | undefined> {
  try {
    const bytes = fromBase64Url(text);
    const opened = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      await ticketKey(secret),
      bytes.slice(12),
    );
    return JSON.parse(new TextDecoder().decode(opened)) as Ticket;
  } catch {
    return undefined;
  }
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname?: string; lastname?: string };
};

/**
 * Signs Ride in to Strava on the rider's behalf. The Worker only holds the client secret: it
 * swaps Strava's code for tokens, refreshes them later, and stores nothing. The app keeps the
 * tokens on the device.
 *
 * Any app can claim the `trainstackride` scheme the rider is sent back to, so the tokens are not
 * in that redirect. It carries a ticket instead: the tokens encrypted with a key only the Worker
 * has, and tied to the SHA-256 challenge the app sent when it started. Only the app that holds the
 * verifier behind that challenge can redeem the ticket for the tokens.
 */
export function stravaRoutes(env: StravaConfig, fetcher: typeof fetch = fetch) {
  const app = new Hono();

  const credentials = () =>
    env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET
      ? { id: env.STRAVA_CLIENT_ID, secret: env.STRAVA_CLIENT_SECRET }
      : undefined;

  const callbackUrl = (requestUrl: string) => `${new URL(requestUrl).origin}/strava/callback`;

  const timingSafeEqual = (a: string, b: string) =>
    a.length === b.length &&
    a.split("").reduce((diff, ch, i) => diff | (ch.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

  const toApp = (params: Record<string, string>) => {
    const url = new URL(APP_REDIRECT);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  };

  const requestTokens = async (secret: string, id: string, body: Record<string, string>) => {
    const response = await fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, ...body }),
    });
    return {
      status: response.status,
      tokens: response.ok ? ((await response.json()) as TokenResponse) : undefined,
    };
  };

  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
  });

  // The app opens this in a web authentication session, and Strava's sign-in follows.
  app.get("/authorize", (c) => {
    const keys = credentials();
    if (!keys) return c.json({ error: "strava_not_configured" }, 503);
    const state = c.req.query("state") ?? "";
    const challenge = c.req.query("code_challenge") ?? "";
    if (!STATE.test(state) || !CHALLENGE.test(challenge)) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: keys.id,
      redirect_uri: callbackUrl(c.req.url),
      response_type: "code",
      approval_prompt: "auto",
      scope: SCOPE,
      // Strava gives this back unchanged, which carries the challenge through its sign-in.
      state: `${state}.${challenge}`,
    }).toString();
    return c.redirect(url.toString(), 302);
  });

  // Strava sends the rider back here with a code, and the app gets a ticket for the tokens.
  app.get("/callback", async (c) => {
    const [state = "", challenge = "", ...extra] = (c.req.query("state") ?? "").split(".");
    if (!STATE.test(state) || !CHALLENGE.test(challenge) || extra.length > 0) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const keys = credentials();
    if (!keys) return c.redirect(toApp({ state, error: "strava_not_configured" }), 302);

    const code = c.req.query("code");
    if (c.req.query("error") || !code) {
      return c.redirect(toApp({ state, error: "access_denied" }), 302);
    }
    // Strava lets the rider untick what they grant, and Ride cannot upload without this.
    if (!(c.req.query("scope") ?? "").split(",").includes(SCOPE)) {
      return c.redirect(toApp({ state, error: "insufficient_scope" }), 302);
    }

    const { tokens } = await requestTokens(keys.secret, keys.id, {
      code,
      grant_type: "authorization_code",
    });
    if (!tokens) return c.redirect(toApp({ state, error: "exchange_failed" }), 302);
    const athlete = tokens.athlete;
    const name = athlete ? [athlete.firstname, athlete.lastname].filter(Boolean).join(" ") : "";
    const ticket = await seal(keys.secret, {
      challenge,
      expires: Math.floor(Date.now() / 1000) + TICKET_LIFETIME_SECONDS,
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
        ...(name ? { athlete_name: name } : {}),
      },
    });
    return c.redirect(toApp({ state, ticket }), 302);
  });

  // The app trades its ticket and the verifier it kept to itself for the tokens.
  app.post("/redeem", async (c) => {
    const keys = credentials();
    if (!keys) return c.json({ error: "strava_not_configured" }, 503);
    const body = await c.req.json().catch(() => undefined);
    const { ticket, code_verifier: verifier } = body ?? {};
    if (typeof ticket !== "string" || ticket.length > 2048 || !VERIFIER.test(verifier ?? "")) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const opened = await open(keys.secret, ticket);
    const challenge = toBase64Url(await crypto.subtle.digest("SHA-256", encoder.encode(verifier)));
    if (
      !opened ||
      opened.expires < Date.now() / 1000 ||
      !timingSafeEqual(challenge, opened.challenge)
    ) {
      return c.json({ error: "invalid_ticket" }, 400);
    }
    return c.json(opened.tokens);
  });

  // Strava's access tokens last six hours, so the app asks for a new one when it needs it.
  app.post("/refresh", async (c) => {
    const keys = credentials();
    if (!keys) return c.json({ error: "strava_not_configured" }, 503);
    const body = await c.req.json().catch(() => undefined);
    const refreshToken = body?.refresh_token;
    if (
      typeof refreshToken !== "string" ||
      refreshToken.length === 0 ||
      refreshToken.length > 256
    ) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const { status, tokens } = await requestTokens(keys.secret, keys.id, {
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    if (!tokens) {
      // Strava turns away a token the rider revoked; anything else is Strava being unavailable.
      return status === 400 || status === 401
        ? c.json({ error: "invalid_refresh_token" }, 401)
        : c.json({ error: "strava_unavailable" }, 502);
    }
    return c.json({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_at,
    });
  });

  return app;
}
