import { env } from "@trainstack/prehab-env/server";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

import * as schema from "./schema";

export function createDb() {
  return drizzle(env.DATABASE_URL, { schema });
}

export const db = createDb();

export async function testDatabaseConnection(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (error) {
    console.error("Database connection failed:", error);
    return false;
  }
}

export * from "./schema";
