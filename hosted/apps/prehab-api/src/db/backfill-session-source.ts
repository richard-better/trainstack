/**
 * Backfill sessions.source from the soft generationContext.source string
 * (PRE-145). New columns ship with safe defaults — status='ready', source='daily'
 * — so the only rows that need promoting are template-sourced sessions, which
 * recorded `{ source: "template" }` in generationContext before this was a real
 * column. Idempotent; safe to run after every db:push until the column is the
 * sole source of truth.
 *
 * Run via: bun run db:backfill-session-source
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

async function backfill() {
  console.log("\n── Backfill sessions.source ──");
  const result = await db.execute(
    sql`UPDATE sessions
        SET source = 'template'
        WHERE generation_context->>'source' = 'template'
          AND source <> 'template'`,
  );
  console.log(`  Promoted ${result.rowCount ?? 0} template-sourced session(s).`);
  console.log("\nDone.");
  process.exit(0);
}

backfill();
