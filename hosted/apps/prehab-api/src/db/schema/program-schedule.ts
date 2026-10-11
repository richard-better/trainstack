import { relations } from "drizzle-orm";
import {
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plans } from "./plans";

export const sessionTypeEnum = pgEnum("session_type", [
  "prehab",
  "recovery",
  "mobility",
  "activation",
]);

export const programSchedule = pgTable(
  "program_schedule",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Stored as YYYY-MM-DD in user's local timezone (client sends local date)
    date: date("date").notNull(),
    // Plan this schedule day belongs to (PRE-143). Nullable for backfill safety;
    // every row is attached to the user's active plan by the backfill migration,
    // and app code sets it on all new rows. Plan-scoping is an app-level invariant,
    // not a DB constraint (PRE-142).
    planId: text("plan_id").references(() => plans.id, { onDelete: "cascade" }),
    sessionTheme: text("session_theme").notNull(),
    sessionType: sessionTypeEnum("session_type").notNull().default("prehab"),
    // Pre-generation layer (PRE-145): a day can render its title + length from
    // the schedule *before* any exercises exist — that's what makes the home
    // feel instant. Nullable so AI-scaffolded days (no template) backfill cleanly.
    title: text("title"),
    estimatedDurationMin: integer("estimated_duration_min"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("program_schedule_user_date_unique").on(table.userId, table.date),
    index("program_schedule_user_id_idx").on(table.userId),
  ],
);

export const programScheduleRelations = relations(programSchedule, ({ one }) => ({
  user: one(user, { fields: [programSchedule.userId], references: [user.id] }),
  plan: one(plans, { fields: [programSchedule.planId], references: [plans.id] }),
}));
