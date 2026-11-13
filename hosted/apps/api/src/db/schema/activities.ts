import type { ActivitySummaryError } from "@trainstack/contract";
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

export type ActivityFileFormat = "fit" | "gpx" | "tcx";
export type { ActivitySummaryError };

export const activity = sqliteTable(
  "activity",
  {
    userId: ownedBy(),
    id: text("id").notNull(),
    source: text("source").notNull(),
    sourceId: text("source_id"),
    sport: text("sport"),
    name: text("name"),
    startedAt: timestamp("started_at"),
    fileFormat: text("file_format").$type<ActivityFileFormat>(),
    fileSize: integer("file_size"),
    summarizedAt: timestamp("summarized_at"),
    fileSport: text("file_sport"),
    fileName: text("file_name"),
    summaryVersion: integer("summary_version"),
    summaryError: text("summary_error").$type<ActivitySummaryError>(),
    summaryAttempts: integer("summary_attempts").notNull().default(0),
    createdAt: timestamp("created_at").default(now).notNull(),
    occurredAt: integer("occurred_at")
      .generatedAlwaysAs(sql`coalesce(started_at, created_at)`, { mode: "virtual" })
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("activity_user_occurred_idx").on(table.userId, table.occurredAt, table.id),
    index("activity_user_source_idx").on(table.userId, table.source, table.sourceId),
    index("activity_summary_version_idx").on(table.summaryVersion),
  ],
);

export const activityStatistic = sqliteTable(
  "activity_statistic",
  {
    userId: text("user_id").notNull(),
    activityId: text("activity_id").notNull(),
    name: text("name").notNull(),
    value: real("value").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.activityId, table.name] }),
    foreignKey({
      columns: [table.userId, table.activityId],
      foreignColumns: [activity.userId, activity.id],
    }).onDelete("cascade"),
    index("activity_statistic_user_name_idx").on(table.userId, table.name),
  ],
);

export const activityEvent = sqliteTable(
  "activity_event",
  {
    userId: text("user_id").notNull(),
    activityId: text("activity_id").notNull(),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    startedAt: timestamp("started_at").notNull(),
    endedAt: timestamp("ended_at"),
    data: text("data", { mode: "json" })
      .$type<Record<string, string | number | boolean>>()
      .notNull()
      .default(sql`'{}'`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.activityId, table.sequence] }),
    foreignKey({
      columns: [table.userId, table.activityId],
      foreignColumns: [activity.userId, activity.id],
    }).onDelete("cascade"),
  ],
);

export const deletedActivity = sqliteTable(
  "deleted_activity",
  {
    userId: ownedBy(),
    id: text("id").notNull(),
    deletedAt: timestamp("deleted_at").default(now).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.id] })],
);

export const activitySync = sqliteTable(
  "activity_sync",
  {
    userId: ownedBy(),
    source: text("source").notNull(),
    cursor: text("cursor"),
    syncedAt: timestamp("synced_at"),
    error: text("error"),
    updatedAt: timestamp("updated_at")
      .default(now)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.source] })],
);
