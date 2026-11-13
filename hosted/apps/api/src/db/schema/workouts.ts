import type { WorkoutOrigin } from "@trainstack/contract";
import type { Workout } from "@trainstack/workout";
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

import { user } from "./auth";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
const ownedBy = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });

export const workout = sqliteTable(
  "workout",
  {
    userId: ownedBy(),
    id: text("id").notNull(),
    name: text("name"),
    sortName: text("sort_name"),
    sport: text("sport").$type<Workout["sport"]>(),
    focus: text("focus").$type<NonNullable<Workout["focus"]>>(),
    description: text("description"),
    author: text("author"),
    tags: text("tags", { mode: "json" }).$type<string[]>(),
    totalSeconds: real("total_seconds"),
    totalMeters: real("total_meters"),
    searchText: text("search_text"),
    body: text("body"),
    origin: text("origin", { mode: "json" }).$type<NonNullable<WorkoutOrigin>>(),
    createdAt: timestamp("created_at").default(now).notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    deletedAt: timestamp("deleted_at"),
    revision: integer("revision").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("workout_user_revision_idx").on(table.userId, table.revision),
    index("workout_user_updated_idx").on(table.userId, table.updatedAt, table.id),
    index("workout_user_name_idx").on(table.userId, table.sortName, table.id),
    index("workout_user_duration_idx").on(table.userId, table.totalSeconds, table.id),
  ],
);

export const workoutList = sqliteTable(
  "workout_list",
  {
    userId: ownedBy(),
    id: text("id").notNull(),
    name: text("name"),
    createdAt: timestamp("created_at").default(now).notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    deletedAt: timestamp("deleted_at"),
    revision: integer("revision").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("workout_list_user_revision_idx").on(table.userId, table.revision),
  ],
);

export const workoutListEntry = sqliteTable(
  "workout_list_entry",
  {
    userId: ownedBy(),
    listId: text("list_id").notNull(),
    workoutId: text("workout_id").notNull(),
    position: real("position").notNull(),
    removed: integer("removed", { mode: "boolean" }).notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    revision: integer("revision").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.listId, table.workoutId] }),
    foreignKey({
      columns: [table.userId, table.listId],
      foreignColumns: [workoutList.userId, workoutList.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId, table.workoutId],
      foreignColumns: [workout.userId, workout.id],
    }).onDelete("cascade"),
    index("workout_list_entry_user_workout_idx").on(table.userId, table.workoutId),
    index("workout_list_entry_user_revision_idx").on(table.userId, table.revision),
  ],
);
