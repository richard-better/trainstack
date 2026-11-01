import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, verify } from "node:crypto";
import { after, before, test } from "node:test";
import { mockApple } from "./helpers/apple.mjs";
import { api, migrate, startWorker } from "./helpers/worker.mjs";

const APP = "trainstackride://signed-in";
const APPLE_ORIGIN = "https://appleid.apple.com";
const signingKey = generateKeyPairSync("ec", { namedCurve: "P-256" });
const appleWeb = {
  APPLE_SIGN_IN_KEY_ID: "TESTKEY123",
  APPLE_SIGN_IN_PRIVATE_KEY: signingKey.privateKey.export({ type: "pkcs8", format: "pem" }),
};

const apple = mockApple();
let worker;
let runtime;

before(
  async () => {
    worker = await startWorker({ bindings: appleWeb, outboundService: (r) => apple.fetch(r) });
    runtime = worker.runtime;
    await migrate(runtime);
  },
  { timeout: 60_000 },
);

after(async () => {
  await worker?.dispose();
});

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** A web authentication session: keeps its own cookies and does not follow redirects. */
function browser(target = runtime) {
  const jar = new Map();
  return {
    jar,
    async visit(url, init = {}) {
      const headers = new Headers(init.headers);
      if (jar.size) {
        headers.set("Cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
      }
      const response = await target.dispatchFetch(url, { ...init, headers, redirect: "manual" });
      for (const raw of response.headers.getSetCookie()) {
        const [pair, ...attributes] = raw.split(";");
        const name = pair.slice(0, pair.indexOf("=")).trim();
        const value = pair.slice(pair.indexOf("=") + 1);
        if (!value || attributes.some((a) => /^\s*max-age=0\s*$/i.test(a))) jar.delete(name);
        else jar.set(name, value);
      }
      return response;
    },
  };
}

/** Runs the app's browser sign-in up to the redirect that ends the web authentication session. */
async function signInThroughBrowser({ challenge, approve = {}, deny = false } = {}) {
  const session = browser();
  const start = await session.visit(
    `${api}/api/auth/app-handoff/apple?code_challenge=${challenge ?? pkce().challenge}`,
  );
  assert.equal(start.status, 302, await start.clone().text());
  const { form, redirectURI } = apple.authorize(start.headers.get("location"), approve);
  assert.equal(redirectURI, `${api}/api/auth/callback/apple`);
  if (deny) {
    form.delete("code");
    form.set("error", "user_cancelled_authorize");
  }
  const posted = await session.visit(redirectURI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: APPLE_ORIGIN },
    body: form.toString(),
  });
  assert.equal(posted.status, 302, await posted.clone().text());
  const back = await session.visit(posted.headers.get("location"));
  return { session, start, back, location: back.headers.get("location") };
}

function redeem(body, headers = {}) {
  return runtime.dispatchFetch(`${api}/api/auth/app-handoff/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const codeOf = (location) => {
  assert.ok(location?.startsWith(`${APP}?`), `redirects to the app: ${location}`);
  return new URL(location).searchParams.get("code");
};

const sessionsOf = async (userId) => {
  const db = await runtime.getD1Database("DB");
  return (
    await db.prepare("SELECT count(*) AS n FROM session WHERE user_id = ?").bind(userId).first()
  ).n;
};

test("a rider signs in through the browser and only the app that asked gets a session", async () => {
  const { verifier, challenge } = pkce();
  const email = "web@example.com";
  const { start, back, location } = await signInThroughBrowser({
    challenge,
    approve: { email, name: "Web Rider" },
  });
  assert.equal(start.headers.get("cache-control"), "no-store");
  const authorize = new URL(start.headers.get("location"));
  assert.equal(authorize.searchParams.get("client_id"), "com.trainstackhq.ride.web");

  // The browser leaves with a code for the app and nothing that signs it in.
  const code = codeOf(location);
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(new URL(location).searchParams.get("token"), null);
  assert.equal(back.headers.get("set-auth-token"), null);
  assert.equal(back.headers.get("cache-control"), "no-store");
  assert.equal(back.headers.get("referrer-policy"), "no-referrer");
  for (const cookie of back.headers.getSetCookie()) {
    if (/session_(token|data)/.test(cookie)) assert.match(cookie, /Max-Age=0/i, cookie);
  }
  const db = await runtime.getD1Database("DB");
  const user = await db.prepare('SELECT id, name FROM "user" WHERE email = ?').bind(email).first();
  assert.equal(user.name, "Web Rider", "Apple's first post names the rider");
  assert.equal(await sessionsOf(user.id), 0, "the browser's session is gone");
  const stored = await db.prepare("SELECT code_hash FROM app_handoff").all();
  assert.ok(
    stored.results.every((row) => row.code_hash !== code),
    "only the code's hash is kept",
  );

  // Apple's token endpoint was called as the Services ID, with a client secret signed by the key.
  const exchange = apple.tokenRequests.at(-1);
  assert.equal(exchange.get("client_id"), "com.trainstackhq.ride.web");
  const [header, payload, signature] = exchange.get("client_secret").split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), {
    alg: "ES256",
    kid: "TESTKEY123",
  });
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  assert.equal(claims.iss, "S64PDPJKMJ");
  assert.equal(claims.sub, "com.trainstackhq.ride.web");
  assert.equal(claims.aud, "https://appleid.apple.com");
  assert.ok(claims.exp - claims.iat <= 3600);
  assert.ok(
    verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      { key: signingKey.publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    ),
  );

  const redeemed = await redeem({ code, code_verifier: verifier });
  assert.equal(redeemed.status, 200, await redeemed.clone().text());
  assert.equal(redeemed.headers.get("cache-control"), "no-store");
  const { token, user: signedIn } = await redeemed.json();
  assert.deepEqual(signedIn, { name: "Web Rider" });
  const session = await runtime.dispatchFetch(`${api}/api/auth/get-session`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal((await session.json()).user.email, email);
  assert.equal(await sessionsOf(user.id), 1);

  const replayed = await redeem({ code, code_verifier: verifier });
  assert.equal(replayed.status, 400);
});

test("a code is no use without its verifier, or once it has expired", async () => {
  const { verifier, challenge } = pkce();
  const code = codeOf((await signInThroughBrowser({ challenge })).location);

  assert.equal((await redeem({ code, code_verifier: pkce().verifier })).status, 400);
  assert.equal((await redeem({ code, code_verifier: "short" })).status, 400);
  assert.equal((await redeem({ code: "not-a-code", code_verifier: verifier })).status, 400);
  assert.equal((await redeem({ code_verifier: verifier })).status, 400);

  const db = await runtime.getD1Database("DB");
  await db
    .prepare("UPDATE app_handoff SET expires_at = ?")
    .bind(Date.now() - 1)
    .run();
  assert.equal((await redeem({ code, code_verifier: verifier })).status, 400);
});

test("a code redeemed twice at once makes one session", async () => {
  const { verifier, challenge } = pkce();
  const code = codeOf((await signInThroughBrowser({ challenge })).location);
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => redeem({ code, code_verifier: verifier })),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400, 400, 400, 400]);
});

test("the browser and the app's native sign-in reach the same account", async () => {
  const subject = "000123.same-apple-id";
  const email = "both@example.com";
  const native = await apple.signIn(runtime, { email, subject });
  const { verifier, challenge } = pkce();
  const code = codeOf(
    (await signInThroughBrowser({ challenge, approve: { email, subject } })).location,
  );
  const { token } = await (await redeem({ code, code_verifier: verifier })).json();
  const session = await runtime.dispatchFetch(`${api}/api/auth/get-session`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal((await session.json()).user.id, native.user.id);
});

test("a sign-in that does not finish sends the app an error and no code", async () => {
  const before = (
    await (
      await runtime.getD1Database("DB")
    )
      .prepare("SELECT count(*) AS n FROM app_handoff")
      .first()
  ).n;
  const { location } = await signInThroughBrowser({ deny: true });
  assert.equal(location, `${APP}?error=user_cancelled_authorize`);
  const after = (
    await (
      await runtime.getD1Database("DB")
    )
      .prepare("SELECT count(*) AS n FROM app_handoff")
      .first()
  ).n;
  assert.equal(after, before);
});

test("a sign-in that lost its state goes back to the app only from the app's browser", async () => {
  const fromApp = browser();
  const start = await fromApp.visit(
    `${api}/api/auth/app-handoff/apple?code_challenge=${pkce().challenge}`,
  );
  const { form } = apple.authorize(start.headers.get("location"));
  const forged = `${api}/api/auth/callback/apple?code=${form.get("code")}&state=forged`;
  const lost = await fromApp.visit(forged);
  assert.equal(lost.status, 302);
  assert.match(lost.headers.get("location"), new RegExp(`^${APP}\\?error=[a-z_]+$`));

  const elsewhere = await browser().visit(forged);
  assert.equal(elsewhere.status, 302);
  assert.ok(!elsewhere.headers.get("location").startsWith("trainstackride:"));
});

test("the handoff turns away bad requests", async () => {
  for (const query of ["", "?code_challenge=short", `?code_challenge=${"a".repeat(42)}!`]) {
    const response = await browser().visit(`${api}/api/auth/app-handoff/apple${query}`);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), `${APP}?error=invalid_request`);
  }
  const done = await browser().visit(`${api}/api/auth/app-handoff/done`);
  assert.equal(done.status, 400);
  const doneWithError = await browser().visit(`${api}/api/auth/app-handoff/done?error=<script>`);
  assert.equal(doneWithError.headers.get("location"), `${APP}?error=sign_in_failed`);
});

test("a challenge sent to Better Auth directly does not make a handoff", async () => {
  const response = await runtime.dispatchFetch(`${api}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://trainstackhq.com" },
    body: JSON.stringify({
      provider: "apple",
      callbackURL: "https://trainstackhq.com/",
      additionalData: { appChallenge: pkce().challenge },
    }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const session = browser();
  for (const raw of response.headers.getSetCookie()) {
    const pair = raw.split(";")[0];
    session.jar.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
  }
  const { form } = apple.authorize((await response.json()).url);
  const posted = await session.visit(`${api}/api/auth/callback/apple`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: APPLE_ORIGIN },
    body: form.toString(),
  });
  const back = await session.visit(posted.headers.get("location"));
  assert.equal(back.headers.get("location"), "https://trainstackhq.com/");
});

test("deleting an account revokes what the browser sign-in got from Apple", async () => {
  const { verifier, challenge } = pkce();
  const subject = "000456.leaving";
  const code = codeOf((await signInThroughBrowser({ challenge, approve: { subject } })).location);
  const { token } = await (await redeem({ code, code_verifier: verifier })).json();
  const deleted = await runtime.dispatchFetch(`${api}/api/auth/delete-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  assert.equal(deleted.status, 200, await deleted.clone().text());
  const revoked = apple.revocations.at(-1);
  assert.equal(revoked.get("token"), `apple-refresh-${subject}`);
  assert.equal(revoked.get("token_type_hint"), "refresh_token");
  assert.equal(revoked.get("client_id"), "com.trainstackhq.ride.web");
  assert.ok(revoked.get("client_secret"));
});

test("without the key, the browser sign-in is off and native sign-in still works", async () => {
  const plain = await startWorker({ outboundService: (r) => apple.fetch(r) });
  try {
    await migrate(plain.runtime);
    const response = await browser(plain.runtime).visit(
      `${api}/api/auth/app-handoff/apple?code_challenge=${pkce().challenge}`,
    );
    assert.equal(response.headers.get("location"), `${APP}?error=apple_web_not_configured`);
    const { user } = await apple.signIn(plain.runtime, { email: "native-only@example.com" });
    assert.equal(user.email, "native-only@example.com");
  } finally {
    await plain.dispose();
  }
});

test("the handoff is rate limited by Cloudflare's client address", async () => {
  const production = await startWorker({
    bindings: { ...appleWeb, NODE_ENV: "production" },
    outboundService: (r) => apple.fetch(r),
  });
  try {
    await migrate(production.runtime);
    const start = (ip, extra = {}) =>
      production.runtime.dispatchFetch(
        `${api}/api/auth/app-handoff/apple?code_challenge=${pkce().challenge}`,
        { headers: { "cf-connecting-ip": ip, ...extra }, redirect: "manual" },
      );
    for (let i = 0; i < 10; i++) assert.equal((await start("203.0.113.1")).status, 302);
    assert.equal((await start("203.0.113.1")).status, 429);
    assert.equal((await start("203.0.113.1", { "x-forwarded-for": "198.51.100.7" })).status, 429);
    assert.equal((await start("203.0.113.2")).status, 302);
  } finally {
    await production.dispose();
  }
});
