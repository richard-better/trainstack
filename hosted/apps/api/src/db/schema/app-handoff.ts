import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { unixMilliseconds } from "../columns";
import { user } from "./auth";

export const appHandoff = sqliteTable(
  "app_handoff",
  {
    codeHash: text("code_hash").primaryKey(),
    challenge: text("challenge").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: unixMilliseconds("expires_at").notNull(),
  },
  (table) => [index("app_handoff_expires_idx").on(table.expiresAt)],
);
