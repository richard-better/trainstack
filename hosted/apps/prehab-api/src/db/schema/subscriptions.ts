import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    // Server-side trial start — protects against trial reset on reinstall
    trialStartedAt: timestamp("trial_started_at"),
    subscribedAt: timestamp("subscribed_at"),
    revenueCatCustomerId: text("revenue_cat_customer_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("subscriptions_user_id_idx").on(table.userId)],
);

export const subscriptionRelations = relations(subscriptions, ({ one }) => ({
  user: one(user, { fields: [subscriptions.userId], references: [user.id] }),
}));
