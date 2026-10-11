import { relations } from "drizzle-orm";
import { index, jsonb, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

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
    // Primary sport inferred from first selection
    primarySport: text("primary_sport").notNull(),
    // All selected sports: ['running', 'climbing', 'cycling', 'lifting']
    sports: text("sports").array().notNull().default([]),
    trainingVolumeHrsPerWeek: real("training_volume_hrs_per_week").notNull().default(0),
    // { knee: 0-4, hip: 0-4, shoulder: 0-4, back: 0-4, wrist: 0-4, ankle: 0-4 }
    capacityRatings: jsonb("capacity_ratings").notNull().default({}),
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
