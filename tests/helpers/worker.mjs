import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { rolldown } from "rolldown";

export const origin = "https://trainstackhq.com";
export const api = "https://api.trainstackhq.com";

/**
 * Builds the API Worker and runs it in Cloudflare's local Workers runtime with a D1 database.
 * `outboundService` answers the Worker's requests to other servers, such as Strava.
 */
export async function startWorker({ bindings = {}, outboundService } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "trainstack-worker-"));
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
  const runtime = new Miniflare({
    modulesRoot: directory,
    modules: [{ type: "ESModule", path: join(directory, "worker.mjs") }],
    compatibilityDate: "2026-07-30",
    compatibilityFlags: ["nodejs_compat"],
    cf: false,
    d1Databases: ["DB"],
    outboundService,
    bindings: {
      NODE_ENV: "test",
      BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
      BETTER_AUTH_URL: api,
      CORS_ORIGIN: origin,
      AXIOM_API_KEY: "",
      AXIOM_DATASET: "",
      AXIOM_EDGE_URL: "",
      ...bindings,
    },
  });
  await runtime.ready;
  return {
    runtime,
    async dispose() {
      await runtime.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/** Applies the committed migrations, as deployment does. */
export async function migrate(runtime) {
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
}
