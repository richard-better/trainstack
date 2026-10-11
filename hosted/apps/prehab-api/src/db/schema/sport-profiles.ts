import { relations } from "drizzle-orm";
import { index, pgTable, text, time, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Slim projection over `profile_answers`. Holds only:
 * - identity (id, userId)
 * - quick-read denormalisations the UI/auth gate need synchronously
 *   (`primarySport`, `preferredSessionTime`, `onboardingCompletedAt`)
 *
 * Everything else (sports list, goals, focus areas, equipment, demographics)
 * lives in `profile_answers`. Reads of those fields go through the projection
 * helper that hydrates from the answers table.
 */
export const sportProfiles = pgTable(
  "sport_profiles",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    // Derived from the `sports` answer's highest sport_time bucket. Empty
    // string when the user skipped sports.
    primarySport: text("primary_sport").notNull().default(""),
    // Preferred local time for the daily prehab session (e.g. '18:00:00').
    // Anchors the home timeline card and schedules the daily reminder.
    preferredSessionTime: time("preferred_session_time"),
    // Set when the user accepts the disclaimer screen — flips the auth gate.
    onboardingCompletedAt: timestamp("onboarding_completed_at"),
    // Set the first time the user taps the CTA on the post-Coach reveal screen
    // (PRE-153). Used by the navigation gate to decide whether to route an
    // onboarded user to /plan-reveal or skip straight to home/paywall.
    planRevealSeenAt: timestamp("plan_reveal_seen_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("sport_profiles_user_id_idx").on(table.userId)],
);

export const sportProfileRelations = relations(sportProfiles, ({ one }) => ({
  user: one(user, { fields: [sportProfiles.userId], references: [user.id] }),
}));
