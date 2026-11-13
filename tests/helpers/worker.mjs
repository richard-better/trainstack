import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { Miniflare } from "miniflare";
import { rolldown } from "rolldown";

export const origin = "https://account.trainstackhq.com";
export const api = "https://api.trainstackhq.com";

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
    r2Buckets: ["ACTIVITY_FILES"],
    outboundService,
    bindings: {
      NODE_ENV: "test",
      BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
      BETTER_AUTH_URL: api,
      WEB_APP_ORIGIN: origin,
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

export function rpcClient(runtime, { token, cookie, origin: requestOrigin = origin } = {}) {
  return createORPCClient(
    new RPCLink({
      url: `${api}/rpc`,
      fetch: async (request, options) => {
        const outgoing = new Request(request, options);
        if (requestOrigin) outgoing.headers.set("Origin", requestOrigin);
        if (cookie) outgoing.headers.set("Cookie", cookie);
        if (token) outgoing.headers.set("Authorization", `Bearer ${token}`);
        return send(runtime, outgoing);
      },
    }),
  );
}

export async function send(runtime, request) {
  const response = await runtime.dispatchFetch(request.url, {
    method: request.method,
    headers: Object.fromEntries(request.headers),
    body: request.body ? await request.arrayBuffer() : undefined,
  });
  return new Response(response.body ? await response.arrayBuffer() : null, {
    status: response.status,
    headers: Object.fromEntries(response.headers),
  });
}

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
