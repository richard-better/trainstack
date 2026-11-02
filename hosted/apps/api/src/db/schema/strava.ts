import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import type { Encrypted } from "../../strava/crypto";
import { encrypted, unixSeconds } from "../columns";
import { user } from "./auth";

export const stravaConnection = sqliteTable(
  "strava_connection",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    athleteId: integer("athlete_id").notNull(),
    athleteName: text("athlete_name"),
    accessToken: encrypted("access_token").notNull(),
    refreshToken: encrypted("refresh_token").notNull(),
    expiresAt: unixSeconds("expires_at").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("strava_connection_athlete_idx").on(table.athleteId)],
);

export const stravaBudget = sqliteTable("strava_budget", {
  key: text("key").primaryKey(),
  windowStart: unixSeconds("window_start").notNull(),
  used: integer("used").notNull(),
});

export const stravaLink = sqliteTable(
  "strava_link",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    challenge: text("challenge").notNull(),
    expiresAt: unixSeconds("expires_at").notNull(),
    tokens: text("tokens").$type<Encrypted | "pending">(),
  },
  (table) => [index("strava_link_userId_idx").on(table.userId)],
);
