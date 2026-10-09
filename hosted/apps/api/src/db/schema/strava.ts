import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

/** A rider's Strava sign-in. Rides are uploaded to Strava with it, on the server. */
export const stravaConnection = sqliteTable("strava_connection", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  athleteId: integer("athlete_id").notNull(),
  athleteName: text("athlete_name"),
  /** Encrypted: see `strava/crypto.ts`. */
  accessToken: text("access_token").notNull(),
  /** Encrypted: see `strava/crypto.ts`. */
  refreshToken: text("refresh_token").notNull(),
  /** When the access token runs out, in seconds since the epoch. */
  expiresAt: integer("expires_at").notNull(),
  /**
   * How many calls to Strava the rider has caused since `budgetWindow` (seconds since the epoch),
   * so one rider cannot use up the request limits Strava gives every rider together.
   */
  budgetWindow: integer("budget_window").default(0).notNull(),
  budgetUsed: integer("budget_used").default(0).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

/**
 * A rider connecting Strava, from the app asking for the Strava page until the app collects the
 * result. The app keeps the verifier behind `challenge` to itself, so a sign-in only ever
 * becomes a connection on the account and device that started it, whoever else gets to Strava's
 * callback with the state.
 */
export const stravaLink = sqliteTable(
  "strava_link",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** SHA-256 of the app's verifier, base64url. */
    challenge: text("challenge").notNull(),
    /** In seconds since the epoch. */
    expiresAt: integer("expires_at").notNull(),
    /** Strava's answer, encrypted, once the rider has agreed. */
    tokens: text("tokens"),
  },
  (table) => [index("strava_link_userId_idx").on(table.userId)],
);
