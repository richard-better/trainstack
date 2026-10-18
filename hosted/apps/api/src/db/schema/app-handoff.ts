import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

/**
 * A sign-in finished in the browser, waiting for the app that started it. Only the SHA-256 of the
 * code is kept, and the code is only good with the verifier behind `challenge`, which never left
 * the app. Each row is used once.
 */
export const appHandoff = sqliteTable(
  "app_handoff",
  {
    codeHash: text("code_hash").primaryKey(),
    challenge: text("challenge").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Milliseconds since the epoch. */
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("app_handoff_expires_idx").on(table.expiresAt)],
);
