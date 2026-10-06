import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Miniflare } from "miniflare";
import { rolldown } from "rolldown";

let runtime;
let directory;
const origin = "https://trainstackhq.com";
const api = "https://api.trainstackhq.com";

before(
  async () => {
    directory = await mkdtemp(join(tmpdir(), "trainstack-worker-"));
    const bundle = await rolldown({
      input: "apps/server/src/index.ts",
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

test("committed migrations support health checks and authentication on D1", async () => {
  const db = await runtime.getD1Database("DB");
  const migrations = "packages/db/src/migrations";
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
  assert.equal((await session.json()).user.email, "ci@example.com");

  const untrusted = await runtime.dispatchFetch(`${api}/health`, {
    headers: { Origin: "https://untrusted.example" },
  });
  assert.notEqual(
    untrusted.headers.get("access-control-allow-origin"),
    "https://untrusted.example",
  );
});
