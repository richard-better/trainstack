import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { mockApple } from "./helpers/apple.mjs";
import { browserThatDoesNotFollowRedirects } from "./helpers/browser.mjs";
import { api, migrate, origin, startWorker } from "./helpers/worker.mjs";

const APPLE_ORIGIN = "https://appleid.apple.com";
const MARKETING_SITE = "https://trainstackhq.com";
const home = `${origin}/`;

const apple = mockApple();
let worker;
let runtime;

before(
  async () => {
    worker = await startWorker({
      bindings: {
        NODE_ENV: "production",
        APPLE_SIGN_IN_KEY_ID: "TESTKEY123",
        APPLE_SIGN_IN_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "P-256" })
          .privateKey.export({ type: "pkcs8", format: "pem" })
          .toString(),
      },
      outboundService: (r) => apple.fetch(r),
    });
    runtime = worker.runtime;
    await migrate(runtime);
  },
  { timeout: 60_000 },
);

after(async () => {
  await worker?.dispose();
});

let lastAddress = 0;

function fromItsOwnAddress() {
  lastAddress += 1;
  const address = `198.51.100.${lastAddress}`;
  return {
    dispatchFetch(url, init = {}) {
      const headers = new Headers(init.headers);
      headers.set("cf-connecting-ip", address);
      return runtime.dispatchFetch(url, { ...init, headers });
    },
  };
}

function webApp(browser, path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Origin", origin);
  if (init.body) headers.set("Content-Type", "application/json");
  return browser.visit(`${api}/api/auth${path}`, { ...init, headers });
}

async function startSignIn(browser) {
  const started = await webApp(browser, "/sign-in/social", {
    method: "POST",
    body: JSON.stringify({ provider: "apple", callbackURL: home, errorCallbackURL: home }),
  });
  assert.equal(started.status, 200, await started.clone().text());
  return started;
}

async function returnFromApple(browser, form) {
  const posted = await browser.visit(`${api}/api/auth/callback/apple`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: APPLE_ORIGIN },
    body: form.toString(),
  });
  assert.equal(posted.status, 302, await posted.clone().text());
  return browser.visit(posted.headers.get("location"));
}

async function signInOnTheWeb(approve) {
  const browser = browserThatDoesNotFollowRedirects(fromItsOwnAddress());
  const started = await startSignIn(browser);
  const { form } = apple.authorize((await started.json()).url, approve);
  const back = await returnFromApple(browser, form);
  return { browser, started, back };
}

async function sessionOf(browser) {
  const response = await webApp(browser, "/get-session");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  return response.json();
}

test("a person signs in on the web, stays signed in across reloads and signs out", async () => {
  const email = `${randomUUID()}@privaterelay.appleid.com`;
  const { browser, started, back } = await signInOnTheWeb({ email, name: "Web Athlete" });

  assert.equal(started.headers.get("access-control-allow-origin"), origin);
  assert.equal(back.status, 302);
  assert.equal(back.headers.get("location"), home, "Apple's flow ends back in the web app");
  const sessionCookie = back.headers
    .getSetCookie()
    .find((raw) => raw.startsWith("__Secure-better-auth.session_token="));
  assert.ok(sessionCookie, "the browser keeps a session");
  assert.match(sessionCookie, /HttpOnly/i);
  assert.match(sessionCookie, /Secure/i);
  assert.match(sessionCookie, /SameSite=None/i);

  const signedIn = await sessionOf(browser);
  assert.equal(signedIn.user.email, email);
  assert.equal(signedIn.user.name, "Web Athlete");
  const reloaded = await sessionOf(browser);
  assert.equal(reloaded.user.id, signedIn.user.id);

  const signedOut = await webApp(browser, "/sign-out", { method: "POST", body: "{}" });
  assert.equal(signedOut.status, 200, await signedOut.clone().text());
  assert.equal(await sessionOf(browser), null);
});

test("signing in on the web reaches the account the app made for the same Apple ID", async () => {
  const subject = `001234.${randomUUID()}`;
  const email = `${randomUUID()}@example.com`;
  const native = await apple.signIn(fromItsOwnAddress(), { email, subject });

  const { browser } = await signInOnTheWeb({ email, subject });

  assert.equal((await sessionOf(browser)).user.id, native.user.id);
  const db = await runtime.getD1Database("DB");
  const accounts = await db
    .prepare("SELECT count(*) AS n FROM account WHERE account_id = ? AND provider_id = 'apple'")
    .bind(subject)
    .first();
  assert.equal(accounts.n, 1);
});

test("the app signs in to an account first made on the web", async () => {
  const subject = `001234.${randomUUID()}`;
  const email = `${randomUUID()}@example.com`;
  const { browser } = await signInOnTheWeb({ email, subject });
  const web = await sessionOf(browser);

  const native = await apple.signIn(fromItsOwnAddress(), { email, subject });

  assert.equal(native.user.id, web.user.id);
});

test("a cancelled sign-in goes back to the web app with an error and no session", async () => {
  const browser = browserThatDoesNotFollowRedirects(fromItsOwnAddress());
  const started = await startSignIn(browser);
  const { form } = apple.authorize((await started.json()).url);
  form.delete("code");
  form.set("error", "user_cancelled_authorize");

  const back = await returnFromApple(browser, form);

  const location = new URL(back.headers.get("location"), api);
  assert.equal(`${location.origin}${location.pathname}`, home);
  assert.equal(location.searchParams.get("error"), "user_cancelled_authorize");
  assert.equal(await sessionOf(browser), null);
});

test("sign-in only returns to the web app", async () => {
  for (const callbackURL of [`${MARKETING_SITE}/`, "https://untrusted.example/"]) {
    const response = await fromItsOwnAddress().dispatchFetch(`${api}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ provider: "apple", callbackURL }),
    });
    assert.equal(response.status, 403, callbackURL);
  }
});

test("only the web app may call the API with the browser's cookies", async () => {
  const preflight = (from) =>
    fromItsOwnAddress().dispatchFetch(`${api}/api/auth/sign-in/social`, {
      method: "OPTIONS",
      headers: {
        Origin: from,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
  const allowed = await preflight(origin);
  assert.equal(allowed.headers.get("access-control-allow-origin"), origin);
  assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
  for (const other of [MARKETING_SITE, "https://untrusted.example"]) {
    assert.notEqual((await preflight(other)).headers.get("access-control-allow-origin"), other);
  }
});
