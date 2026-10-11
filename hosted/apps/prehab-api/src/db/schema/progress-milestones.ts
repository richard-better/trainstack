import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const progressMilestones = pgTable(
  "progress_milestones",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sport: text("sport").notNull(),
    // e.g. 'ran_5k_pain_free', 'back_climbing_project_grade'
    milestoneType: text("milestone_type").notNull(),
    achievedAt: timestamp("achieved_at").defaultNow().notNull(),
    notes: text("notes"),
  },
  (table) => [index("progress_milestones_user_id_idx").on(table.userId)],
);

export const progressMilestoneRelations = relations(progressMilestones, ({ one }) => ({
  user: one(user, { fields: [progressMilestones.userId], references: [user.id] }),
}));
