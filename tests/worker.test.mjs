import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { hashPassword } from "better-auth/crypto";
import { api, migrate, origin, rpcClient, startWorker } from "./helpers/worker.mjs";
import { mockApple } from "./helpers/apple.mjs";

let worker;
let runtime;
const apple = mockApple();

before(
  async () => {
    worker = await startWorker({ outboundService: apple.fetch });
    runtime = worker.runtime;
  },
  { timeout: 60_000 },
);

after(async () => {
  await worker?.dispose();
});

test("health fails before migrations, without exposing database errors", async () => {
  const response = await runtime.dispatchFetch(`${api}/health`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "unavailable" });
});

test("committed migrations support health and authentication on D1 without Axiom", async () => {
  await migrate(runtime);

  const health = await runtime.dispatchFetch(`${api}/health`, { headers: { Origin: origin } });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("access-control-allow-origin"), origin);
  assert.equal(health.headers.get("access-control-allow-credentials"), "true");
  assert.deepEqual(await health.json(), { status: "ok" });

  const anonymous = rpcClient(runtime);
  assert.equal(await anonymous.healthCheck(), "OK");
  await assert.rejects(anonymous.activities.list({}), { code: "UNAUTHORIZED", status: 401 });

  const { response: signup, cookie } = await apple.signIn(runtime, { email: "ci@example.com" });
  assert.match(signup.headers.get("set-cookie"), /HttpOnly/i);
  assert.match(signup.headers.get("set-cookie"), /Secure/i);
  const session = await runtime.dispatchFetch(`${api}/api/auth/get-session`, {
    headers: { Cookie: cookie },
  });
  assert.equal(session.status, 200);
  const sessionUser = (await session.json()).user;
  assert.equal(sessionUser.email, "ci@example.com");

  assert.deepEqual(await rpcClient(runtime, { cookie }).activities.list({}), {
    activities: [],
    nextCursor: null,
  });

  const publicApi = await runtime.dispatchFetch(`${api}/api-reference/healthCheck`, {
    method: "POST",
  });
  assert.equal(publicApi.status, 200);
  assert.equal(await publicApi.json(), "OK");
  const anonymousApi = await runtime.dispatchFetch(`${api}/api-reference/activities`);
  assert.equal(anonymousApi.status, 401);
  assert.equal((await anonymousApi.json()).code, "UNAUTHORIZED");
  const authenticatedApi = await runtime.dispatchFetch(`${api}/api-reference/activities`, {
    headers: { Cookie: cookie },
  });
  assert.equal(authenticatedApi.status, 200);
  assert.deepEqual(await authenticatedApi.json(), { activities: [], nextCursor: null });

  const invalidSession = rpcClient(runtime, { cookie: "better-auth.session_token=invalid" });
  await assert.rejects(invalidSession.activities.list({}), { code: "UNAUTHORIZED", status: 401 });

  const untrusted = await runtime.dispatchFetch(`${api}/health`, {
    headers: { Origin: "https://untrusted.example" },
  });
  assert.notEqual(
    untrusted.headers.get("access-control-allow-origin"),
    "https://untrusted.example",
  );
});

test("OpenAPI reference describes contract outputs and authentication errors", async () => {
  const response = await runtime.dispatchFetch(`${api}/api-reference/spec.json`);
  assert.equal(response.status, 200);
  const spec = await response.json();
  assert.equal(
    spec.paths["/healthCheck"].post.responses[200].content["application/json"].schema.const,
    "OK",
  );
  const list = spec.paths["/activities"].get.responses;
  assert.ok(list[401]);
  const schema = list[200].content["application/json"].schema;
  assert.deepEqual(schema.required, ["activities", "nextCursor"]);
  const upload = spec.paths["/activities"].post;
  assert.ok(upload.requestBody.content["multipart/form-data"]);
  assert.ok(upload.responses[410]);
  assert.ok(spec.paths["/activities/{id}"].delete);
  assert.ok(spec.paths["/activities/{id}/file"].get);
});

test("a native app signs in with a bearer token and can delete its account", async () => {
  const { token } = await apple.signIn(runtime, { email: "native@example.com" });

  const session = await runtime.dispatchFetch(`${api}/api/auth/get-session`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal((await session.json()).user.email, "native@example.com");
  const anonymous = await runtime.dispatchFetch(`${api}/api/auth/get-session`);
  assert.equal(await anonymous.json(), null);

  const deleted = await runtime.dispatchFetch(`${api}/api/auth/delete-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  assert.equal(deleted.status, 200, await deleted.clone().text());
  const after = await runtime.dispatchFetch(`${api}/api/auth/get-session`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(await after.json(), null);
});

test("email signup cannot reserve an address ahead of Sign in with Apple", async () => {
  const email = "victim@example.com";
  const response = await runtime.dispatchFetch(`${api}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ name: "Squatter", email, password: "test-password-12345" }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "EMAIL_PASSWORD_SIGN_UP_DISABLED");
  assert.equal(response.headers.get("set-auth-token"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  const db = await runtime.getD1Database("DB");
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM "user" WHERE email = ?').bind(email).first()).n,
    0,
  );

  const { user } = await apple.signIn(runtime, { email });
  assert.equal(user.email, email);
  assert.equal(user.emailVerified, true);
  const returning = await apple.signIn(runtime, { email });
  assert.equal(returning.user.id, user.id);
});

test("email and password sign-in is disabled even for a legacy account with a valid password", async () => {
  const db = await runtime.getD1Database("DB");
  const email = "legacy@example.com";
  const password = "test-password-12345";
  await db.batch([
    db
      .prepare('INSERT INTO "user" (id, name, email, updated_at) VALUES (?, ?, ?, ?)')
      .bind("legacy", "Legacy Rider", email, Date.now()),
    db
      .prepare(
        "INSERT INTO account (id, account_id, provider_id, user_id, password, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "legacy-credential",
        "legacy",
        "credential",
        "legacy",
        await hashPassword(password),
        Date.now(),
      ),
  ]);
  const response = await runtime.dispatchFetch(`${api}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "EMAIL_PASSWORD_DISABLED");
  assert.equal(response.headers.get("set-auth-token"), null);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("Sign in with Apple never joins a legacy email account with the same address", async () => {
  const db = await runtime.getD1Database("DB");
  const email = "unverified-legacy@example.com";
  await db.batch([
    db
      .prepare('INSERT INTO "user" (id, name, email, updated_at) VALUES (?, ?, ?, ?)')
      .bind("unverified-legacy", "Someone Else", email, Date.now()),
    db
      .prepare(
        "INSERT INTO account (id, account_id, provider_id, user_id, password, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "unverified-legacy-credential",
        "unverified-legacy",
        "credential",
        "unverified-legacy",
        await hashPassword("test-password-12345"),
        Date.now(),
      ),
  ]);
  const response = await apple.attemptSignIn(runtime, { email });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "OAUTH_LINK_ERROR");
  assert.equal(response.headers.get("set-auth-token"), null);
  const providers = await db
    .prepare("SELECT provider_id FROM account WHERE user_id = ?")
    .bind("unverified-legacy")
    .all();
  assert.deepEqual(
    providers.results.map((row) => row.provider_id),
    ["credential"],
  );
});

test("Sign in with Apple is offered to the app and refuses a token that is not Apple's", async () => {
  const response = await runtime.dispatchFetch(`${api}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "apple", idToken: { token: "not-a-jwt" } }),
  });
  assert.ok(response.status >= 400 && response.status < 500, `status ${response.status}`);
  const body = await response.json();
  assert.notEqual(body.code, "PROVIDER_NOT_FOUND");
  assert.ok(!response.headers.get("set-auth-token"));
});
