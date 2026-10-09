import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});
