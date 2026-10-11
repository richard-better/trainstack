/**
 * Truncate all tables, push schema, and reseed.
 * Run via: bun run db:reset (requires server to be running for user creation)
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const db = drizzle(DATABASE_URL);

async function truncateAll() {
  console.log("\n── Truncate ──");
  await db.execute(
    sql`DO $$ DECLARE r RECORD; BEGIN FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE'; END LOOP; END $$`,
  );
  console.log("  All tables truncated.");
}

function run(label: string, cmd: string[]) {
  console.log(`\n── ${label} ──`);
  const result = Bun.spawnSync(cmd, {
    stdio: ["inherit", "inherit", "inherit"],
    cwd: import.meta.dir + "/../..",
    env: process.env,
  });
  if (result.exitCode !== 0) {
    console.error(`  ${label} failed (exit ${result.exitCode})`);
    process.exit(1);
  }
}

async function reset() {
  await truncateAll();
  run("Push schema", ["drizzle-kit", "push"]);
  run("Seed", ["bun", "run", "src/db/seed.ts"]);
  console.log("\nDone.");
  process.exit(0);
}

reset();
