import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { activity } from "./activities";

import { user } from "./auth";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export type PlannedKind = "workout" | "note" | "rest";

export const plannedWorkout = sqliteTable(
  "planned_workout",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    day: text("day"),
    position: real("position"),
    placedAt: timestamp("placed_at"),
    kind: text("kind").$type<PlannedKind>(),
    planId: text("plan_id"),
    content: text("content"),
    contentAt: timestamp("content_at"),
    plannedSeconds: real("planned_seconds"),
    plannedMeters: real("planned_meters"),
    plannedLoad: real("planned_load"),
    skipped: integer("skipped", { mode: "boolean" }).notNull().default(false),
    skipReason: text("skip_reason"),
    skippedAt: timestamp("skipped_at"),
    createdAt: timestamp("created_at").default(now).notNull(),
    deletedAt: timestamp("deleted_at"),
    revision: integer("revision").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("planned_workout_user_day_idx").on(table.userId, table.day, table.position, table.id),
    index("planned_workout_user_revision_idx").on(table.userId, table.revision),
    index("planned_workout_user_plan_idx").on(table.userId, table.planId),
  ],
);

export const plannedPairingChoice = sqliteTable(
  "planned_pairing_choice",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    plannedId: text("planned_id").notNull(),
    activityId: text("activity_id").notNull(),
    paired: integer("paired", { mode: "boolean" }).notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.plannedId, table.activityId] }),
    foreignKey({
      columns: [table.userId, table.activityId],
      foreignColumns: [activity.userId, activity.id],
    }).onDelete("cascade"),
    index("planned_pairing_choice_user_activity_idx").on(table.userId, table.activityId),
  ],
);
