import type { ActivityAnalysisError, ActivityRoute } from "@trainstack/contract";
import { sql } from "drizzle-orm";
import { foreignKey, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { activity } from "./activities";

export type { ActivityAnalysisError };

export const activityAnalysis = sqliteTable(
  "activity_analysis",
  {
    userId: text("user_id").notNull(),
    activityId: text("activity_id").notNull(),
    version: integer("version").notNull().default(0),
    generation: integer("generation").notNull().default(1),
    due: integer("due", { mode: "boolean" }).notNull().default(true),
    attempts: integer("attempts").notNull().default(0),
    analyzedAt: integer("analyzed_at", { mode: "timestamp_ms" }),
    error: text("error").$type<ActivityAnalysisError>(),
    profile: text("profile"),
    missingThresholds: text("missing_thresholds", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    route: text("route", { mode: "json" }).$type<ActivityRoute>(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.activityId] }),
    foreignKey({
      columns: [table.userId, table.activityId],
      foreignColumns: [activity.userId, activity.id],
    }).onDelete("cascade"),
    index("activity_analysis_due_idx").on(table.due),
    index("activity_analysis_version_idx").on(table.version),
  ],
);
