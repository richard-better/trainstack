import { relations } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Event-sourced answers to discrete onboarding (and, later, re-assessment)
 * questions. Each row = one user's response to one question at one version.
 *
 * Adding a new question means appending to the contract's `QUESTIONS` map and
 * the `OnboardingFlow` constant — no schema migration. Bumping a question's
 * `version` only affects new starts; existing users stay locked to the version
 * they answered at.
 */
export const profileAnswers = pgTable(
  "profile_answers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull(), // 'answered' | 'skipped'
    value: jsonb("value"), // null when skipped
    recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  },
  (table) => [
    unique("profile_answers_user_question_unique").on(table.userId, table.questionId),
    index("profile_answers_user_id_idx").on(table.userId),
  ],
);

export const profileAnswerRelations = relations(profileAnswers, ({ one }) => ({
  user: one(user, { fields: [profileAnswers.userId], references: [user.id] }),
}));
