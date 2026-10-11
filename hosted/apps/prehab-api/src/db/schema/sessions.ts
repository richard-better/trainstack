import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Per-item lifecycle (PRE-145). A day is a collection of typed session items;
 * each item moves pending → generating → ready (or → failed). Default `ready`
 * so existing rows backfill for free — the request path inserts `pending`.
 */
export const sessionStatusEnum = pgEnum("session_status", [
  "pending",
  "generating",
  "ready",
  "failed",
]);

/**
 * What produced this session (PRE-145). Promotes the soft
 * `generationContext.source` string into a real column so day-view lookups
 * stop guessing "first row for the date wins".
 */
export const sessionSourceEnum = pgEnum("session_source", ["daily", "template", "on_demand"]);

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
    // Lifecycle. Default `ready` backfills existing rows; request path inserts `pending`.
    status: sessionStatusEnum("status").notNull().default("ready"),
    // Set when generation fails (status = 'failed'); surfaced for retry.
    generationError: text("generation_error"),
    // Real column replacing the soft generationContext.source string.
    // Default `daily` backfills existing rows; a post-push backfill promotes
    // template-sourced rows from generationContext (see backfill-session-source.ts).
    source: sessionSourceEnum("source").notNull().default("daily"),
    // Regenerate = append + archive: the superseded row is stamped here, not deleted.
    archivedAt: timestamp("archived_at"),
    // Regeneration lineage — points at the row this one replaced.
    replacesSessionId: text("replaces_session_id").references((): AnyPgColumn => sessions.id),
    // Full GeneratedSession JSON
    exercises: jsonb("exercises").notNull().default([]),
    completedAt: timestamp("completed_at"),
    // Index of last completed exercise (0-based); null = not started
    dropOffExerciseIndex: integer("drop_off_exercise_index"),
    // Array of exercise indices the user skipped (0-based)
    skippedExercises: jsonb("skipped_exercises").notNull().default([]),
    // Completion feedback: 'bad' | 'good' | 'amazing' | null (null = skipped)
    feedbackRating: text("feedback_rating"),
    // Tags selected during feedback (e.g. ["felt_great", "less_stiff"])
    feedbackTags: jsonb("feedback_tags").notNull().default([]),
    // Optional free-text comment
    feedbackComment: text("feedback_comment").notNull().default(""),
    // True when user's capacity ratings were all low — no exercises generated
    isRestDay: boolean("is_rest_day").notNull().default(false),
    // Debug: { model, prompt_version, inputs_snapshot }
    generationContext: jsonb("generation_context"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    // Day-view + idempotency lookups filter user + date + source, archived excluded.
    index("sessions_user_date_source_idx").on(table.userId, table.sessionDate, table.source),
  ],
);

export const appSessionRelations = relations(sessions, ({ one }) => ({
  user: one(user, { fields: [sessions.userId], references: [user.id] }),
}));
