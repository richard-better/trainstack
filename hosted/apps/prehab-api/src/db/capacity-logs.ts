import { relations } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { sessions } from "./sessions";

export const capacityLogs = pgTable(
  "capacity_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Nullable: standalone daily check-ins not tied to a session
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    // { knee: 0-4, hip: 0-4, shoulder: 0-4, back: 0-4, wrist: 0-4, ankle: 0-4 }
    capacityRatingsBefore: jsonb("capacity_ratings_before").notNull(),
    // Null if user skipped post-session re-rating
    capacityRatingsAfter: jsonb("capacity_ratings_after"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("capacity_logs_user_id_idx").on(table.userId),
    index("capacity_logs_session_id_idx").on(table.sessionId),
  ],
);

export const capacityLogRelations = relations(capacityLogs, ({ one }) => ({
  user: one(user, { fields: [capacityLogs.userId], references: [user.id] }),
  session: one(sessions, { fields: [capacityLogs.sessionId], references: [sessions.id] }),
}));
