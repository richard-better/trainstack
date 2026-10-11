import { relations } from "drizzle-orm";
import { date, index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const dailyCheckIns = pgTable(
  "daily_check_ins",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    checkInDate: date("check_in_date").notNull(),
    readiness: text("readiness").notNull(), // 'low' | 'normal' | 'high'
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("daily_check_ins_user_date_unique").on(table.userId, table.checkInDate),
    index("daily_check_ins_user_id_idx").on(table.userId),
  ],
);

export const dailyCheckInRelations = relations(dailyCheckIns, ({ one }) => ({
  user: one(user, { fields: [dailyCheckIns.userId], references: [user.id] }),
}));
