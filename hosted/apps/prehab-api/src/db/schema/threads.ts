import { relations } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Generic thread/message store. Today only used for the onboarding Coach chat
 * (`type = 'intake'`). Schema is version-agnostic so future agent surfaces
 * (Coach tab, daily check-in chat, etc.) can extend the `type` discriminator.
 */
export const threads = pgTable(
  "threads",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // 'intake' for v2
    status: text("status").notNull(), // 'pending' | 'completed' | 'skipped'
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    // Set when the Coach `flagRedFlag` tool fires for severe symptoms.
    // Operationally surfaces threads needing human follow-up.
    flaggedForReviewAt: timestamp("flagged_for_review_at"),
    flagReason: text("flag_reason"),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("threads_user_id_type_idx").on(table.userId, table.type)],
);

export const messages = pgTable(
  "messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    // Vercel AI SDK v6 UIMessage roles: 'system' | 'user' | 'assistant'.
    // Tool calls and results are encoded as `parts` within an assistant message — not a separate role.
    role: text("role").notNull(),
    // The `parts` array of a Vercel AI SDK v6 UIMessage. Storing UIMessage parts (not ModelMessage)
    // so we can replay the full UI history — text deltas, tool calls, tool results — on resume.
    content: jsonb("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("messages_thread_id_created_at_idx").on(table.threadId, table.createdAt)],
);

export const intakeSummaries = pgTable("intake_summaries", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  threadId: text("thread_id").references(() => threads.id, { onDelete: "set null" }),
  summary: jsonb("summary").notNull(),
  version: integer("version").notNull().default(1),
  extractedAt: timestamp("extracted_at").defaultNow().notNull(),
});

export const threadRelations = relations(threads, ({ one, many }) => ({
  user: one(user, { fields: [threads.userId], references: [user.id] }),
  messages: many(messages),
}));

export const messageRelations = relations(messages, ({ one }) => ({
  thread: one(threads, { fields: [messages.threadId], references: [threads.id] }),
}));

export const intakeSummaryRelations = relations(intakeSummaries, ({ one }) => ({
  user: one(user, { fields: [intakeSummaries.userId], references: [user.id] }),
  thread: one(threads, { fields: [intakeSummaries.threadId], references: [threads.id] }),
}));
