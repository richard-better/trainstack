import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { unixSeconds } from "../columns";
import { user } from "./auth";

export const feedback = sqliteTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: unixSeconds("created_at").notNull(),
    issueNumber: integer("issue_number"),
  },
  (table) => [index("feedback_user_created_idx").on(table.userId, table.createdAt)],
);
