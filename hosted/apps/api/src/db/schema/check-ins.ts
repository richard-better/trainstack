import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

export const checkIn = sqliteTable(
  "check_in",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    value: text("value").notNull(),
    removed: integer("removed", { mode: "boolean" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
);
