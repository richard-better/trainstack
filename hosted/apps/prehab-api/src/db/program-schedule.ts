import { relations } from "drizzle-orm";
import { date, index, pgEnum, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const sessionTypeEnum = pgEnum("session_type", [
  "prehab",
  "recovery",
  "mobility",
  "activation",
]);

export const programSchedule = pgTable(
  "program_schedule",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Stored as YYYY-MM-DD in user's local timezone (client sends local date)
    date: date("date").notNull(),
    sessionTheme: text("session_theme").notNull(),
    sessionType: sessionTypeEnum("session_type").notNull().default("prehab"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("program_schedule_user_date_unique").on(table.userId, table.date),
    index("program_schedule_user_id_idx").on(table.userId),
  ],
);

export const programScheduleRelations = relations(programSchedule, ({ one }) => ({
  user: one(user, { fields: [programSchedule.userId], references: [user.id] }),
}));
