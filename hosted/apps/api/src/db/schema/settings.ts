import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

export const athleteSetting = sqliteTable(
  "athlete_setting",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    scope: text("scope").notNull(),
    name: text("name").notNull(),
    day: text("day").notNull(),
    value: text("value").notNull(),
    removed: integer("removed", { mode: "boolean" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    revision: integer("revision").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.kind, table.scope, table.name, table.day] }),
    index("athlete_setting_user_revision_idx").on(table.userId, table.revision),
  ],
);
