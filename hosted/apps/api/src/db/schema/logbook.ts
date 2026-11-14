import type { Equipment, ExerciseMeasure, LoggedSport, Muscle } from "@trainstack/logbook";
import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { activity } from "./activities";
import { user } from "./auth";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const loggedSession = sqliteTable(
  "logged_session",
  {
    userId: text("user_id").notNull(),
    id: text("id").notNull(),
    activityId: text("activity_id").notNull(),
    sport: text("sport").$type<LoggedSport>().notNull(),
    body: text("body").notNull(),
    editedAt: timestamp("edited_at").notNull(),
    createdAt: timestamp("created_at").default(now).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    uniqueIndex("logged_session_user_activity_idx").on(table.userId, table.activityId),
    index("logged_session_user_sport_idx").on(table.userId, table.sport),
    foreignKey({
      columns: [table.userId, table.activityId],
      foreignColumns: [activity.userId, activity.id],
    }).onDelete("cascade"),
  ],
);

export const customExercise = sqliteTable(
  "custom_exercise",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    name: text("name").notNull(),
    equipment: text("equipment").$type<Equipment>().notNull(),
    primaryMuscles: text("primary_muscles", { mode: "json" }).$type<Muscle[]>().notNull(),
    secondaryMuscles: text("secondary_muscles", { mode: "json" }).$type<Muscle[]>().notNull(),
    measure: text("measure").$type<ExerciseMeasure>().notNull(),
    bodyweight: integer("bodyweight", { mode: "boolean" }).notNull(),
    editedAt: timestamp("edited_at").notNull(),
    createdAt: timestamp("created_at").default(now).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.id] })],
);
