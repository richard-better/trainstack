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
const STATE = /^[A-Za-z0-9_-]{16,128}$/;

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname?: string; lastname?: string };
};

/**
 * Signs Ride in to Strava on the rider's behalf. The Worker only holds the client secret: it
 * swaps Strava's code for tokens and passes them to the app, which keeps them on the device,
 * and it refreshes them later. It stores nothing.
 */
export function stravaRoutes(env: StravaConfig, fetcher: typeof fetch = fetch) {
  const app = new Hono();

  const credentials = () =>
    env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET
      ? { id: env.STRAVA_CLIENT_ID, secret: env.STRAVA_CLIENT_SECRET }
      : undefined;

  const callbackUrl = (requestUrl: string) => `${new URL(requestUrl).origin}/strava/callback`;

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
    if (!STATE.test(state)) return c.json({ error: "invalid_state" }, 400);
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: keys.id,
      redirect_uri: callbackUrl(c.req.url),
      response_type: "code",
      approval_prompt: "auto",
      scope: SCOPE,
      state,
    }).toString();
    return c.redirect(url.toString(), 302);
  });

  // Strava sends the rider back here with a code, and the app gets the tokens in return.
  app.get("/callback", async (c) => {
    const state = c.req.query("state") ?? "";
    if (!STATE.test(state)) return c.json({ error: "invalid_state" }, 400);
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
    return c.redirect(
      toApp({
        state,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: String(tokens.expires_at),
        ...(athlete
          ? {
              athlete_id: String(athlete.id),
              athlete_name: [athlete.firstname, athlete.lastname].filter(Boolean).join(" "),
            }
          : {}),
      }),
      302,
    );
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
