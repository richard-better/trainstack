import { relations } from "drizzle-orm";
import { date, index, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const sessions = pgTable(
  "sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // YYYY-MM-DD in user's local timezone — client sends new Date().toLocaleDateString('en-CA')
    sessionDate: date("session_date").notNull(),
    // Full GeneratedSession JSON
    exercises: jsonb("exercises").notNull().default([]),
    completedAt: timestamp("completed_at"),
    // Index of last completed exercise (0-based); null = not started
    dropOffExerciseIndex: integer("drop_off_exercise_index"),
    // Completion feedback: 'bad' | 'good' | 'amazing' | null (null = skipped)
    feedbackRating: text("feedback_rating"),
    // Debug: { model, prompt_version, inputs_snapshot }
    generationContext: jsonb("generation_context"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Exactly one session per user per day; concurrent inserts use ON CONFLICT DO NOTHING
    unique("sessions_user_date_unique").on(table.userId, table.sessionDate),
    index("sessions_user_id_idx").on(table.userId),
  ],
);

export const appSessionRelations = relations(sessions, ({ one }) => ({
  user: one(user, { fields: [sessions.userId], references: [user.id] }),
}));
