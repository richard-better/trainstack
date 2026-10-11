import { relations } from "drizzle-orm";
import { index, integer, jsonb, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Per-call LLM observability (PRE-131).
 *
 * One row per model invocation across every AI surface — daily session
 * generation, regenerate, weekly scaffold, plan-reveal copy, intake-summary
 * extraction, the Coach stream, and admin playground replays. Captures the
 * token counts, an estimated cost, the model/provider, and wall-clock latency,
 * tagged by user + endpoint so spend is queryable per user and per endpoint
 * (the visibility complement to PRE-119's spend caps).
 *
 * This is the queryable store; the same data is also emitted as an OTel span
 * (gen_ai.* attributes) so it flows through the existing OTLP pipeline when an
 * exporter is configured. See services/llm/observability.ts.
 *
 * `userId` is nullable + ON DELETE SET NULL: playground/synthetic calls have no
 * user, and we keep cost history even after an account is purged.
 */
export const llmCallLogs = pgTable(
  "llm_call_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    // Which AI surface made the call. Free-text (not a pg enum) so adding a new
    // surface doesn't need a migration — the set is enumerated in the contract.
    endpoint: text("endpoint").notNull(),
    // The SDK operation: 'generateObject' | 'stream'.
    operation: text("operation").notNull().default("generateObject"),
    provider: text("provider").notNull(), // 'google' | 'anthropic' | …
    model: text("model").notNull(),
    status: text("status").notNull().default("ok"), // 'ok' | 'error'
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    // Estimated USD cost from the per-model price table. numeric → string in JS;
    // the contract coerces back to a number. Null when usage is unavailable.
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    latencyMs: integer("latency_ms").notNull(),
    errorMessage: text("error_message"),
    // Prompt version + any extra context (lean flag, attempt count, sessionId…).
    promptVersion: text("prompt_version"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("llm_call_logs_user_id_idx").on(table.userId),
    index("llm_call_logs_endpoint_idx").on(table.endpoint),
    index("llm_call_logs_created_at_idx").on(table.createdAt),
  ],
);

export const llmCallLogRelations = relations(llmCallLogs, ({ one }) => ({
  user: one(user, { fields: [llmCallLogs.userId], references: [user.id] }),
}));
