import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * A bounded, first-class training plan (PRE-142 / PRE-143).
 *
 * Two sources: `generated` (built from onboarding) and `template` (instantiated
 * from a curated plan template — those live in code, not the DB, so
 * `planTemplateId` holds the template's slug, not an FK; see PRE-144).
 *
 * Bounded (~6 weeks), not eternal: major re-evaluation happens *after* a block,
 * never automatically mid-block. At most one `active` plan per user — enforced in
 * app logic at transition points (activate → supersede the previous), not a DB
 * constraint (PRE-142 rejects re-importing one-per-X constraints).
 */
export const planSourceEnum = pgEnum("plan_source", ["generated", "template"]);
export const planStatusEnum = pgEnum("plan_status", ["active", "completed", "superseded"]);
// Per-plan async generation lifecycle (PRE-153). Independent of plan `status`
// so a still-generating plan can already be the `active` row — the reveal
// screen polls this until it flips `ready` / `failed`.
export const planGenerationStatusEnum = pgEnum("plan_generation_status", [
  "pending",
  "ready",
  "failed",
]);

export const plans = pgTable(
  "plans",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: planSourceEnum("source").notNull(),
    status: planStatusEnum("status").notNull().default("active"),
    // Bounded block, stored as YYYY-MM-DD in the user's local timezone.
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    // Set when source = 'template' — the curated template's slug (templates live
    // in code, not the DB, so this is a plain string, not an FK). See PRE-144.
    planTemplateId: text("plan_template_id"),
    // Lineage: points at the plan that replaced this one when superseded.
    supersededByPlanId: text("superseded_by_plan_id").references((): AnyPgColumn => plans.id),
    // Goals / focus areas the plan was built from, frozen at creation.
    goalsSnapshot: jsonb("goals_snapshot"),
    focusSnapshot: jsonb("focus_snapshot"),
    // LLM-generated reveal copy (PRE-153). Headline + optional subtitle render at
    // the top of the post-coach reveal screen; themes (3–5 strings) are bullets
    // below the recap. Nullable so the row can be inserted before the LLM call
    // returns — the worker fills them in.
    headline: text("headline"),
    subtitle: text("subtitle"),
    themes: jsonb("themes"),
    // Lifecycle for async plan generation (PRE-153). The reveal screen polls
    // until `status` flips `pending` → `ready` (or `failed`, which surfaces a
    // retry CTA). Defaults to `ready` so backfilled / template plans keep
    // working without changes.
    generationStatus: planGenerationStatusEnum("generation_status").notNull().default("ready"),
    generationError: text("generation_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("plans_user_id_idx").on(table.userId),
    index("plans_user_status_idx").on(table.userId, table.status),
  ],
);

export const plansRelations = relations(plans, ({ one }) => ({
  user: one(user, { fields: [plans.userId], references: [user.id] }),
  supersededBy: one(plans, {
    fields: [plans.supersededByPlanId],
    references: [plans.id],
    relationName: "plan_supersession",
  }),
}));
