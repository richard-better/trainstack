import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { api, migrate, origin, startWorker } from "./helpers/worker.mjs";

let worker;
let runtime;

function rpcClient(cookie) {
  return createORPCClient(
    new RPCLink({
      url: `${api}/rpc`,
      fetch: async (request, options) => {
        const outgoing = new Request(request, options);
        outgoing.headers.set("Origin", origin);
        if (cookie) outgoing.headers.set("Cookie", cookie);
        return runtime.dispatchFetch(outgoing.url, {
          method: outgoing.method,
          headers: Object.fromEntries(outgoing.headers),
          body: outgoing.body ? await outgoing.arrayBuffer() : undefined,
        });
      },
    }),
  );
}

before(
  async () => {
    worker = await startWorker();
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

  const anonymous = rpcClient();
  assert.equal(await anonymous.healthCheck(), "OK");
  await assert.rejects(anonymous.privateData(), { code: "UNAUTHORIZED", status: 401 });

  const signup = await runtime.dispatchFetch(`${api}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      name: "CI User",
      email: "ci@example.com",
      password: "ci-test-password-123",
    }),
  });
  assert.equal(signup.status, 200, await signup.clone().text());
  assert.match(signup.headers.get("set-cookie"), /HttpOnly/i);
  assert.match(signup.headers.get("set-cookie"), /Secure/i);
  const cookie = signup.headers.get("set-cookie").split(";")[0];
  const session = await runtime.dispatchFetch(`${api}/api/auth/get-session`, {
    headers: { Cookie: cookie },
  });
  assert.equal(session.status, 200);
  const sessionUser = (await session.json()).user;
  assert.equal(sessionUser.email, "ci@example.com");

  const privateData = await rpcClient(cookie).privateData();
  assert.equal(privateData.message, "This is private");
  assert.deepEqual(JSON.parse(JSON.stringify(privateData.user)), sessionUser);
  assert.ok(privateData.user.createdAt instanceof Date);
  assert.ok(privateData.user.updatedAt instanceof Date);

  const publicApi = await runtime.dispatchFetch(`${api}/api-reference/healthCheck`, {
    method: "POST",
  });
  assert.equal(publicApi.status, 200);
  assert.equal(await publicApi.json(), "OK");
  const anonymousApi = await runtime.dispatchFetch(`${api}/api-reference/privateData`, {
    method: "POST",
  });
  assert.equal(anonymousApi.status, 401);
  assert.equal((await anonymousApi.json()).code, "UNAUTHORIZED");
  const authenticatedApi = await runtime.dispatchFetch(`${api}/api-reference/privateData`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  assert.equal(authenticatedApi.status, 200);
  assert.deepEqual(await authenticatedApi.json(), {
    message: "This is private",
    user: sessionUser,
  });

  const invalidSession = rpcClient("better-auth.session_token=invalid");
  await assert.rejects(invalidSession.privateData(), { code: "UNAUTHORIZED", status: 401 });

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
  const privateData = spec.paths["/privateData"].post.responses;
  assert.ok(privateData[401]);
  const schema = privateData[200].content["application/json"].schema;
  assert.deepEqual(schema.required, ["message", "user"]);
  assert.equal(schema.properties.user.properties.email.type, "string");
});

test("a native app signs in with a bearer token and can delete its account", async () => {
  const signup = await runtime.dispatchFetch(`${api}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      name: "Native User",
      email: "native@example.com",
      password: "native-test-password-123",
    }),
  });
  assert.equal(signup.status, 200, await signup.clone().text());
  const token = signup.headers.get("set-auth-token");
  assert.ok(token, "the session token is exposed for the app to keep");

  const session = await runtime.dispatchFetch(`${api}/api/auth/get-session`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal((await session.json()).user.email, "native@example.com");
  const anonymous = await runtime.dispatchFetch(`${api}/api/auth/get-session`);
  assert.equal(await anonymous.json(), null);

  const deleted = await runtime.dispatchFetch(`${api}/api/auth/delete-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password: "native-test-password-123" }),
  });
  assert.equal(deleted.status, 200, await deleted.clone().text());
  const after = await runtime.dispatchFetch(`${api}/api/auth/get-session`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(await after.json(), null);
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
