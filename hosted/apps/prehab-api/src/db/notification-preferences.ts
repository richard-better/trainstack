import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, time, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    // Time of day for daily reminder, e.g. '08:00:00'
    preferredTime: time("preferred_time"),
    // IANA timezone string, e.g. 'Europe/Budapest'
    timezone: text("timezone").notNull().default("UTC"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("notification_preferences_user_id_idx").on(table.userId)],
);

export const notificationPreferenceRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(user, { fields: [notificationPreferences.userId], references: [user.id] }),
}));
