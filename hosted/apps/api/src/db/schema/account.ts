import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accountFileSweep = sqliteTable(
  "account_file_sweep",
  {
    userId: text("user_id").primaryKey(),
    promise: text("promise").notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("account_file_sweep_deleted_idx").on(table.deletedAt)],
);
