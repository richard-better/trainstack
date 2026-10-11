import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Curated session templates — browsable in the Explore tab.
 * Not tied to any user; human- or AI-curated.
 * Exercises JSONB uses the same GeneratedExercise[] shape as user sessions.
 */
export const sessionTemplates = pgTable(
  "session_templates",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull(), // e.g. "Lower Body", "Shoulders", "Full Body"
    sportTags: jsonb("sport_tags").notNull().default([]), // string[] — empty = all sports
    // Full exercise list — same shape as sessions.exercises (GeneratedSession)
    exercises: jsonb("exercises").notNull(),
    estimatedDurationMin: integer("estimated_duration_min").notNull(),
    exerciseCount: integer("exercise_count").notNull(),
    // Lower = shown first
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("session_templates_sort_idx").on(table.sortOrder)],
);
