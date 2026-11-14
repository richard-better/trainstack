import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { unixSeconds } from "../columns";
import { user } from "./auth";

export const calendarFeed = sqliteTable(
  "calendar_feed",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    feedId: text("feed_id").notNull(),
    withActivities: integer("with_activities", { mode: "boolean" }).notNull(),
    createdAt: unixSeconds("created_at").notNull(),
  },
  (table) => [uniqueIndex("calendar_feed_feed_id_idx").on(table.feedId)],
);
