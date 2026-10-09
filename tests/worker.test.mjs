import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { Miniflare } from "miniflare";
import { rolldown } from "rolldown";

let runtime;
let directory;
const origin = "https://trainstackhq.com";
const api = "https://api.trainstackhq.com";

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
    directory = await mkdtemp(join(tmpdir(), "trainstack-worker-"));
    const bundle = await rolldown({
      input: "hosted/apps/api/src/index.ts",
      platform: "node",
      external: ["cloudflare:workers", /^node:/],
      resolve: { conditionNames: ["workerd", "worker", "browser", "import", "default"] },
    });
    try {
      await bundle.write({
        file: join(directory, "worker.mjs"),
        format: "esm",
        codeSplitting: false,
      });
    } finally {
      await bundle.close();
    }
    runtime = new Miniflare({
      modulesRoot: directory,
      modules: [{ type: "ESModule", path: join(directory, "worker.mjs") }],
      compatibilityDate: "2026-07-30",
      compatibilityFlags: ["nodejs_compat"],
      cf: false,
      d1Databases: ["DB"],
      bindings: {
        NODE_ENV: "test",
        BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
        BETTER_AUTH_URL: api,
        CORS_ORIGIN: origin,
        STRAVA_CLIENT_ID: "12345",
        STRAVA_CLIENT_SECRET: "test-only-strava-secret",
        AXIOM_API_KEY: "",
        AXIOM_DATASET: "",
        AXIOM_EDGE_URL: "",
      },
    });
    await runtime.ready;
  },
  { timeout: 60_000 },
);

after(async () => {
  await runtime?.dispose();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("health fails before migrations, without exposing database errors", async () => {
  const response = await runtime.dispatchFetch(`${api}/health`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "unavailable" });
});

test("committed migrations support health and authentication on D1 without Axiom", async () => {
  const db = await runtime.getD1Database("DB");
  const migrations = "hosted/apps/api/src/db/migrations";
  for (const entry of (await readdir(migrations, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const sql = await readFile(join(migrations, entry.name, "migration.sql"), "utf8");
    await db.batch(
      sql
        .split("--> statement-breakpoint")
        .filter((sql) => sql.trim())
        .map((sql) => db.prepare(sql)),
    );
  }

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

test("the Strava sign-in is served by the Worker", async () => {
  const response = await runtime.dispatchFetch(
    `${api}/strava/authorize?state=abcdefghijklmnopqrstuvwxyz012345&code_challenge=${"c".repeat(43)}`,
    { redirect: "manual" },
  );
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.host, "www.strava.com");
  assert.equal(location.searchParams.get("client_id"), "12345");
  assert.equal(location.searchParams.get("redirect_uri"), `${api}/strava/callback`);
  assert.ok(!response.headers.get("location").includes("test-only-strava-secret"));
});
