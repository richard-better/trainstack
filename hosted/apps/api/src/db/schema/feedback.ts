import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

/**
 * Feedback a rider sent from Ride, which becomes a public GitHub issue. The issue does not say
 * who sent it, so this is the only record of that. Rows also count how much feedback an account
 * has sent recently.
 */
export const feedback = sqliteTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** In seconds since the epoch. */
    createdAt: integer("created_at").notNull(),
    /** The GitHub issue it became, once GitHub has made it. */
    issueNumber: integer("issue_number"),
  },
  (table) => [index("feedback_user_created_idx").on(table.userId, table.createdAt)],
);
