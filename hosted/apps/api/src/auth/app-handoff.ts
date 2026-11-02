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

const APP_WEB_AUTHENTICATION_SESSION_CALLBACK = "trainstackride://signed-in";
const TIME_FOR_THE_APP_TO_COLLECT_A_SIGN_IN_MS = 2 * 60 * 1000;
const UNPADDED_BASE64URL_SHA256 = /^[A-Za-z0-9_-]{43}$/;
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const CODE_BYTES = 32;
const UNPADDED_BASE64URL_OF_32_BYTES = /^[A-Za-z0-9_-]{43}$/;
const BETTER_AUTH_ERROR_CODE = /^[A-Za-z0-9_]{1,64}$/;
const STARTED_FROM_THE_APP_COOKIE = "app_handoff";
const STARTED_FROM_THE_APP_COOKIE_LIFETIME_SECONDS = 10 * 60;

const toBase64Url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const sha256 = async (text: string) =>
  toBase64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

const toApp = (params: Record<string, string>) =>
  `${APP_WEB_AUTHENTICATION_SESSION_CALLBACK}?${new URLSearchParams(params).toString()}`;

const errorCodeForTheApp = (error: string | null | undefined) =>
  error && BETTER_AUTH_ERROR_CODE.test(error) ? error : "sign_in_failed";

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
          if (!challenge || !UNPADDED_BASE64URL_SHA256.test(challenge)) {
            throw c.redirect(toApp({ error: "invalid_request" }));
          }
          await keepWithTheServerSideOAuthState({ appChallenge: challenge });
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
          const marker = c.context.createAuthCookie(STARTED_FROM_THE_APP_COOKIE, {
            maxAge: STARTED_FROM_THE_APP_COOKIE_LIFETIME_SECONDS,
          });
          c.setCookie(marker.name, "1", marker.attributes);
          if (!started.response.url) throw c.redirect(toApp({ error: "sign_in_failed" }));
          throw c.redirect(started.response.url);
        },
      ),

      appHandoffDoneIfTheHookDidNotSendTheBrowserToTheApp: createAuthEndpoint(
        "/app-handoff/done",
        { method: "GET", query: z.object({ error: z.string().optional() }) },
        async (c) => {
          c.setHeader("Cache-Control", "no-store");
          c.setHeader("Referrer-Policy", "no-referrer");
          if (!c.query.error) throw APIError.from("BAD_REQUEST", INVALID_REQUEST);
          throw c.redirect(toApp({ error: errorCodeForTheApp(c.query.error) }));
        },
      ),

      appHandoffToken: createAuthEndpoint(
        "/app-handoff/token",
        { method: "POST", body: z.object({ code: z.string(), code_verifier: z.string() }) },
        async (c) => {
          c.setHeader("Cache-Control", "no-store");
          const { code, code_verifier: verifier } = c.body;
          if (!UNPADDED_BASE64URL_OF_32_BYTES.test(code) || !PKCE_VERIFIER.test(verifier)) {
            throw APIError.from("BAD_REQUEST", INVALID_REQUEST);
          }
          const [handoff] = await checkAndUseUpInOneStatement(options.database)
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
            if (isApplesPostBeforeTheCallbackRedirectsToItself(c.request?.method)) return;
            const location = c.context.responseHeaders?.get("location");
            if (!location) return;
            const state = await getOAuthState();
            const challenge = state?.serverContext?.appChallenge;
            const marker = c.context.createAuthCookie(STARTED_FROM_THE_APP_COOKIE);
            const startedFromTheApp = state
              ? challenge !== undefined
              : Boolean(c.getCookie(marker.name));
            if (!startedFromTheApp) return;
            c.setCookie(marker.name, "", { ...marker.attributes, maxAge: 0 });
            c.setHeader("Cache-Control", "no-store");
            c.setHeader("Referrer-Policy", "no-referrer");

            const created = c.context.newSession;
            if (created) {
              await c.context.internalAdapter.deleteSession(created.session.token);
              dropSessionHeadersSoTheBrowserNeverGetsTheSession(c.context);
            }
            if (
              !created ||
              typeof challenge !== "string" ||
              !UNPADDED_BASE64URL_SHA256.test(challenge)
            ) {
              const error = new URL(location, c.context.baseURL).searchParams.get("error");
              throw c.redirect(toApp({ error: errorCodeForTheApp(error) }));
            }

            const code = toBase64Url(crypto.getRandomValues(new Uint8Array(CODE_BYTES)));
            const now = Date.now();
            await options.database.delete(handoffTable).where(lt(handoffTable.expiresAt, now));
            await options.database.insert(handoffTable).values({
              codeHash: await sha256(code),
              challenge,
              userId: created.user.id,
              expiresAt: now + TIME_FOR_THE_APP_TO_COLLECT_A_SIGN_IN_MS,
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

const keepWithTheServerSideOAuthState = addOAuthServerContext;

const checkAndUseUpInOneStatement = (database: Database) => database.delete(handoffTable);

const isApplesPostBeforeTheCallbackRedirectsToItself = (method: string | undefined) =>
  method === "POST";

const INVALID_REQUEST = { code: "INVALID_REQUEST", message: "Invalid request" };
const INVALID_CODE = { code: "INVALID_CODE", message: "The sign-in code is not valid" };

function dropSessionHeadersSoTheBrowserNeverGetsTheSession(context: {
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
