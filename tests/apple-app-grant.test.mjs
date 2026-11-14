import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { mockApple } from "./helpers/apple.mjs";
import { api, migrate, startWorker } from "./helpers/worker.mjs";

const apple = mockApple();
let worker;
let runtime;
let db;

before(
  async () => {
    worker = await startWorker({
      bindings: {
        APPLE_SIGN_IN_KEY_ID: "TESTKEY123",
        APPLE_SIGN_IN_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "P-256" })
          .privateKey.export({ type: "pkcs8", format: "pem" })
          .toString(),
      },
      outboundService: (request) => apple.fetch(request),
    });
    runtime = worker.runtime;
    await migrate(runtime);
    db = await runtime.getD1Database("DB");
  },
  { timeout: 60_000 },
);

after(async () => {
  await worker?.dispose();
});

async function rideSignsIn() {
  const subject = `001234.${randomUUID()}`;
  const signedIn = await apple.signIn(runtime, { subject });
  return { ...signedIn, subject };
}

const sendCode = (token, body) =>
  runtime.dispatchFetch(`${api}/account/apple-authorization`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

const grantOf = (userId) =>
  db.prepare("SELECT refresh_token FROM apple_app_grant WHERE user_id = ?").bind(userId).first();

const claimsOf = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

const deleteAccount = (token) =>
  runtime.dispatchFetch(`${api}/api/auth/delete-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: "{}",
  });

test("Ride's authorization code is traded with Apple as the app, and its refresh token kept encrypted", async () => {
  const rider = await rideSignsIn();
  const code = apple.appAuthorizationCode({ subject: rider.subject });
  const sent = await sendCode(rider.token, { authorization_code: code });
  assert.equal(sent.status, 204, await sent.clone().text());

  const exchange = apple.tokenRequests.at(-1);
  assert.equal(exchange.get("code"), code);
  assert.equal(exchange.get("grant_type"), "authorization_code");
  assert.equal(exchange.get("client_id"), "com.trainstackhq.ride");
  assert.equal(claimsOf(exchange.get("client_secret")).sub, "com.trainstackhq.ride");

  const grant = await grantOf(rider.user.id);
  assert.ok(grant?.refresh_token);
  assert.ok(!grant.refresh_token.includes(`apple-refresh-${rider.subject}`), "stored encrypted");
});

test("deleting the account revokes what Ride's sign-in got from Apple", async () => {
  const rider = await rideSignsIn();
  await sendCode(rider.token, {
    authorization_code: apple.appAuthorizationCode({ subject: rider.subject }),
  });
  apple.revocations.length = 0;
  const deleted = await deleteAccount(rider.token);
  assert.equal(deleted.status, 200, await deleted.clone().text());
  const revoked = apple.revocations.find(
    (form) => form.get("client_id") === "com.trainstackhq.ride",
  );
  assert.equal(revoked?.get("token"), `apple-refresh-${rider.subject}`);
  assert.equal(revoked.get("token_type_hint"), "refresh_token");
  assert.equal(claimsOf(revoked.get("client_secret")).sub, "com.trainstackhq.ride");
  assert.equal(await grantOf(rider.user.id), null);
});

test("an account whose Ride never sent a code is deleted as before, with nothing to revoke", async () => {
  const rider = await rideSignsIn();
  apple.revocations.length = 0;
  const deleted = await deleteAccount(rider.token);
  assert.equal(deleted.status, 200, await deleted.clone().text());
  assert.deepEqual(apple.revocations, []);
});

test("a code for another Apple ID is refused, and keeps the grant the account had", async () => {
  const rider = await rideSignsIn();
  await sendCode(rider.token, {
    authorization_code: apple.appAuthorizationCode({ subject: rider.subject }),
  });
  const before = await grantOf(rider.user.id);
  const someoneElse = await sendCode(rider.token, {
    authorization_code: apple.appAuthorizationCode({ subject: `001234.${randomUUID()}` }),
  });
  assert.equal(someoneElse.status, 409);
  assert.deepEqual(await someoneElse.json(), { error: "another_apple_id" });
  assert.deepEqual(await grantOf(rider.user.id), before);
});

test("a code Apple refuses, a malformed request and a missing session are answered without storing anything", async () => {
  const rider = await rideSignsIn();
  const refused = await sendCode(rider.token, { authorization_code: "c0.0.used-or-made-up" });
  assert.equal(refused.status, 400);
  assert.deepEqual(await refused.json(), { error: "invalid_code" });
  const malformed = await sendCode(rider.token, { code: "wrong field" });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "invalid_request" });
  const anonymous = await sendCode(null, {
    authorization_code: apple.appAuthorizationCode({ subject: rider.subject }),
  });
  assert.equal(anonymous.status, 401);
  assert.equal(await grantOf(rider.user.id), null);
});

test("an account not made with Sign in with Apple cannot send a code", async () => {
  const rider = await rideSignsIn();
  await db
    .prepare("UPDATE account SET provider_id = 'credential' WHERE user_id = ?")
    .bind(rider.user.id)
    .run();
  const sent = await sendCode(rider.token, {
    authorization_code: apple.appAuthorizationCode({ subject: rider.subject }),
  });
  assert.equal(sent.status, 403);
  assert.deepEqual(await sent.json(), { error: "apple_account_required" });
});
