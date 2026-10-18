import type { BetterAuthPlugin } from "better-auth";
import {
  addOAuthServerContext,
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getOAuthState,
  signInSocial,
} from "better-auth/api";
import { parseSetCookieHeader, toCookieOptions } from "better-auth/cookies";
import { and, eq, gt, lt } from "drizzle-orm";
import * as z from "zod";

import type { Database } from "../db";
import { appHandoff as handoffTable } from "../db/schema";

/** Where the browser goes when it is done, for the app's web authentication session to catch. */
const APP_REDIRECT = "trainstackride://signed-in";
/** How long the app has to collect a finished sign-in. It does so straight away. */
const HANDOFF_LIFETIME_MS = 2 * 60 * 1000;
/** SHA-256 of the app's verifier, base64url without padding. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
/** 32 random bytes, base64url without padding. */
const CODE = /^[A-Za-z0-9_-]{43}$/;
const ERROR_CODE = /^[A-Za-z0-9_]{1,64}$/;
/** Marks a browser that started from the app, so a sign-in that lost its state still goes back. */
const MARKER_COOKIE = "app_handoff";
const MARKER_LIFETIME_SECONDS = 10 * 60;

const toBase64Url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const sha256 = async (text: string) =>
  toBase64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

const toApp = (params: Record<string, string>) =>
  `${APP_REDIRECT}?${new URLSearchParams(params).toString()}`;

/** Better Auth's error code, if it looks like one, for the app to show. */
const appError = (error: string | null | undefined) =>
  error && ERROR_CODE.test(error) ? error : "sign_in_failed";

/**
 * Lets the app sign in with Apple's web flow, for builds that cannot hold the Sign in with Apple
 * entitlement. The app opens `/app-handoff/apple` with a PKCE challenge in a web authentication
 * session. Better Auth runs Apple's flow, and when it ends with a new session, this plugin swaps
 * the browser's session for a single-use code sent to the app. The app trades the code and its
 * verifier for a session of its own at `/app-handoff/token`. No session token ever reaches the
 * browser or a URL, and only the app that made the challenge can redeem the code.
 */
export function appHandoff(options: { database: Database; enabled: boolean }) {
  return {
    id: "app-handoff",
    endpoints: {
      appHandoffApple: createAuthEndpoint(
        "/app-handoff/apple",
        { method: "GET", query: z.object({ code_challenge: z.string().optional() }) },
        async (c) => {
          c.setHeader("Cache-Control", "no-store");
          c.setHeader("Referrer-Policy", "no-referrer");
          if (!options.enabled) throw c.redirect(toApp({ error: "apple_web_not_configured" }));
          const challenge = c.query.code_challenge;
          if (!challenge || !CHALLENGE.test(challenge)) {
            throw c.redirect(toApp({ error: "invalid_request" }));
          }
          // Kept with the OAuth state on the server, where no client can set it.
          await addOAuthServerContext({ appChallenge: challenge });
          const done = `${c.context.baseURL}/app-handoff/done`;
          let started;
          try {
            started = await signInSocial()({
              ...c,
              method: "POST",
              body: {
                provider: "apple",
                callbackURL: done,
                errorCallbackURL: done,
                disableRedirect: true,
              },
              returnHeaders: true,
            });
          } catch (error) {
            c.context.logger.error("Apple's web flow could not start", error);
            throw c.redirect(toApp({ error: "sign_in_failed" }));
          }
          for (const raw of started.headers.getSetCookie()) {
            for (const [name, attributes] of parseSetCookieHeader(raw)) {
              c.setCookie(name, attributes.value, toCookieOptions(attributes));
            }
          }
          const marker = c.context.createAuthCookie(MARKER_COOKIE, {
            maxAge: MARKER_LIFETIME_SECONDS,
          });
          c.setCookie(marker.name, "1", marker.attributes);
          if (!started.response.url) throw c.redirect(toApp({ error: "sign_in_failed" }));
          throw c.redirect(started.response.url);
        },
      ),

      // Better Auth needs somewhere to send the browser. The hook below sends it to the app
      // first, so this is only reached if that did not happen.
      appHandoffDone: createAuthEndpoint(
        "/app-handoff/done",
        { method: "GET", query: z.object({ error: z.string().optional() }) },
        async (c) => {
          c.setHeader("Cache-Control", "no-store");
          c.setHeader("Referrer-Policy", "no-referrer");
          if (!c.query.error) throw APIError.from("BAD_REQUEST", INVALID_REQUEST);
          throw c.redirect(toApp({ error: appError(c.query.error) }));
        },
      ),

      appHandoffToken: createAuthEndpoint(
        "/app-handoff/token",
        { method: "POST", body: z.object({ code: z.string(), code_verifier: z.string() }) },
        async (c) => {
          c.setHeader("Cache-Control", "no-store");
          const { code, code_verifier: verifier } = c.body;
          if (!CODE.test(code) || !VERIFIER.test(verifier)) {
            throw APIError.from("BAD_REQUEST", INVALID_REQUEST);
          }
          // One statement both checks and uses up the code, so it can only ever be redeemed once.
          const [handoff] = await options.database
            .delete(handoffTable)
            .where(
              and(
                eq(handoffTable.codeHash, await sha256(code)),
                eq(handoffTable.challenge, await sha256(verifier)),
                gt(handoffTable.expiresAt, Date.now()),
              ),
            )
            .returning({ userId: handoffTable.userId });
          const user = handoff && (await c.context.internalAdapter.findUserById(handoff.userId));
          if (!user) throw APIError.from("BAD_REQUEST", INVALID_CODE);
          const session = await c.context.internalAdapter.createSession(user.id);
          return c.json({ token: session.token, user: { name: user.name } });
        },
      ),
    },

    hooks: {
      after: [
        {
          matcher: (context) => context.path?.startsWith("/callback/") ?? false,
          handler: createAuthMiddleware(async (c) => {
            if (c.params?.id !== "apple") return;
            // Apple posts to the callback, which sends the browser on to itself before reading
            // the state. Only that second request says how the sign-in went.
            if (c.request?.method === "POST") return;
            const location = c.context.responseHeaders?.get("location");
            if (!location) return;
            const state = await getOAuthState();
            const challenge = state?.serverContext?.appChallenge;
            const marker = c.context.createAuthCookie(MARKER_COOKIE);
            // Neither the state nor the browser says this sign-in came from the app.
            if (state ? challenge === undefined : !c.getCookie(marker.name)) return;
            c.setCookie(marker.name, "", { ...marker.attributes, maxAge: 0 });
            c.setHeader("Cache-Control", "no-store");
            c.setHeader("Referrer-Policy", "no-referrer");

            const created = c.context.newSession;
            if (created) {
              await c.context.internalAdapter.deleteSession(created.session.token);
              dropSessionHeaders(c.context);
            }
            if (!created || typeof challenge !== "string" || !CHALLENGE.test(challenge)) {
              const error = new URL(location, c.context.baseURL).searchParams.get("error");
              throw c.redirect(toApp({ error: appError(error) }));
            }

            const code = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
            const now = Date.now();
            await options.database.delete(handoffTable).where(lt(handoffTable.expiresAt, now));
            await options.database.insert(handoffTable).values({
              codeHash: await sha256(code),
              challenge,
              userId: created.user.id,
              expiresAt: now + HANDOFF_LIFETIME_MS,
            });
            throw c.redirect(toApp({ code }));
          }),
        },
      ],
    },

    rateLimit: [
      {
        pathMatcher: (path) => path === "/app-handoff/apple" || path === "/app-handoff/token",
        window: 60,
        max: 10,
      },
    ],
  } satisfies BetterAuthPlugin;
}

const INVALID_REQUEST = { code: "INVALID_REQUEST", message: "Invalid request" };
const INVALID_CODE = { code: "INVALID_CODE", message: "The sign-in code is not valid" };

/**
 * Takes the browser's new session off the response, so neither its cookies nor the bearer
 * plugin's `set-auth-token` header carry it to the browser.
 */
function dropSessionHeaders(context: {
  responseHeaders?: Headers;
  authCookies: { sessionToken: { name: string }; sessionData: { name: string } };
}) {
  const headers = context.responseHeaders;
  if (!headers) return;
  const names = [context.authCookies.sessionToken.name, context.authCookies.sessionData.name];
  const isSession = (raw: string) => {
    const name = raw.slice(0, raw.indexOf("=")).trim();
    return names.some((session) => name === session || name.startsWith(`${session}.`));
  };
  const kept = headers.getSetCookie().filter((raw) => !isSession(raw));
  headers.delete("set-cookie");
  for (const raw of kept) headers.append("set-cookie", raw);
  headers.delete("set-auth-token");
}
