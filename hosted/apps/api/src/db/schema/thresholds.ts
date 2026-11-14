import type { ThresholdSuggestion } from "@trainstack/contract";
import { foreignKey, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { activity } from "./activities";
import { user } from "./auth";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

export const thresholdSuggestion = sqliteTable(
  "threshold_suggestion",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    threshold: text("threshold").$type<ThresholdSuggestion["threshold"]>().notNull(),
    id: text("id").notNull().unique(),
    value: integer("value").notNull(),
    method: text("method").$type<ThresholdSuggestion["method"]>().notNull(),
    confidence: text("confidence").$type<ThresholdSuggestion["confidence"]>().notNull(),
    activityId: text("activity_id").notNull(),
    effortDay: text("effort_day").notNull(),
    evidence: text("evidence", { mode: "json" }).$type<ThresholdSuggestion["evidence"]>().notNull(),
    signals: text("signals", { mode: "json" }).$type<string[]>().notNull(),
    fingerprint: text("fingerprint").notNull(),
    detectedAt: timestamp("detected_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.scope, table.threshold] }),
    foreignKey({
      columns: [table.userId, table.activityId],
      foreignColumns: [activity.userId, activity.id],
    }).onDelete("cascade"),
  ],
);

export const thresholdAnswer = sqliteTable(
  "threshold_answer",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    threshold: text("threshold").notNull(),
    fingerprint: text("fingerprint").notNull(),
    value: integer("value").notNull(),
    answer: text("answer").$type<"accepted" | "dismissed">().notNull(),
    answeredAt: timestamp("answered_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.scope, table.threshold, table.fingerprint] }),
  ],
);

export const thresholdDetection = sqliteTable("threshold_detection", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  analysedThrough: integer("analysed_through").notNull(),
  analysedCount: integer("analysed_count").notNull(),
  settingsRevision: integer("settings_revision").notNull(),
  detectedAt: timestamp("detected_at").notNull(),
});
