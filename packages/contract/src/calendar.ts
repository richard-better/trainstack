import { oc } from "@orpc/contract";
import { workoutSchema } from "@trainstack/workout";
import { z } from "zod";

import { settingDaySchema } from "./settings.ts";
import { builtinWorkoutIdSchema, workoutIdSchema } from "./workouts.ts";

export const MAX_CALENDAR_DAYS = 92;
export const MAX_PLANNED_PER_DAY = 20;
export const MAX_PLANNED_TEXT = 4000;

const activityId = z.string().regex(/^[0-9a-f]{64}$/);

const daysApart = (from: string, through: string) =>
  (Date.parse(`${through}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

export const plannedWorkoutIdSchema = z
  .uuid()
  .describe(
    "Chosen by the client that plans it, so a device can plan offline and a replayed plan changes nothing",
  );

export const planIdSchema = z
  .uuid()
  .describe(
    "Groups the planned workouts a plan put on the calendar, so the plan can later be changed or removed as one. Null for what the athlete planned by hand",
  );

const editedAt = z
  .date()
  .describe(
    "When the athlete made this edit, by the device's clock. Of two edits to the same part of a planned workout, the later one wins; of two at the same moment, the server picks the same one in either order",
  );

const text = z.string().trim().min(1).max(MAX_PLANNED_TEXT);

export const plannedWorkoutSourceSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("library"),
      id: workoutIdSchema,
      updatedAt: z.date().describe("The updatedAt of the library workout that was copied"),
    }),
    z.object({ kind: z.literal("builtin"), id: builtinWorkoutIdSchema }),
  ])
  .nullable()
  .describe(
    "Where the embedded workout was copied from, for provenance only: a later edit to the library workout changes no planned day",
  );

export const plannedContentSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("workout"),
      workout: workoutSchema.describe("A copy of the workout, whole and self-contained"),
      source: plannedWorkoutSourceSchema,
      notes: text.nullable().describe("The athlete's or coach's note on the day"),
    }),
    z.object({
      kind: z.literal("note"),
      title: text.max(200),
      notes: text.nullable(),
    }),
    z.object({
      kind: z.literal("rest"),
      notes: text.nullable(),
    }),
  ])
  .describe("A workout to do, a note on the day, or a rest day");

export const plannedNumbersSchema = z
  .object({
    seconds: z
      .number()
      .nullable()
      .describe(
        "How long the workout takes. Distance steps count at the speed their target asks for against the day's threshold pace; null when that needs a threshold the day lacks",
      ),
    meters: z
      .number()
      .nullable()
      .describe(
        "How far, for a workout with distance steps; its timed steps count at their target speed. Null for a workout measured only in time, or when a threshold is missing",
      ),
    load: z
      .number()
      .nullable()
      .describe(
        "The planned training stress, in TSS: 100 × hours × IF², where IF is the workout's normalized intensity (a 30-second rolling fourth-power mean, as for normalized power) of each second's target as a share of the day's threshold (FTP, threshold speed or lactate threshold heart rate). A range counts at its middle, a ramp along its length, a max effort at 1.5, and a step with no target at a share by its intensity: warm-up 0.55, active 0.75, recovery 0.5, rest 0, cool-down 0.5, none 0.65. Null when a target needs a threshold the day lacks",
      ),
  })
  .describe(
    "What the workout asks for, in numbers comparable with an activity's, worked out with the athlete's thresholds of the planned day when it was planned, moved or changed. Null for a note or a rest day",
  );

export const plannedStateSchema = z
  .enum(["planned", "skipped", "missed"])
  .describe(
    "planned: still to do, or a note or rest day. skipped: the athlete said they will not do it. missed: a workout on a day before the athlete's today that was neither done nor skipped",
  );

export const plannedWorkoutSchema = z.object({
  id: plannedWorkoutIdSchema,
  day: settingDaySchema,
  position: z.number().describe("Orders the planned workouts of a day, lowest first"),
  content: plannedContentSchema,
  planId: planIdSchema.nullable(),
  planned: plannedNumbersSchema.nullable(),
  skipped: z
    .object({ reason: text.max(500).nullable() })
    .nullable()
    .describe("Set when the athlete marked it skipped, with why"),
  state: plannedStateSchema,
  createdAt: z.date(),
  updatedAt: z.date().describe("The latest edit to any part of it, by the editing device's clock"),
});

export const plannedDeletionSchema = z.object({
  id: plannedWorkoutIdSchema,
  deletedAt: z.date(),
});

export const calendarTotalsSchema = z.object({
  seconds: z.number(),
  meters: z.number(),
  load: z.number(),
});

export const plannedAgainstCompletedSchema = z.object({
  planned: calendarTotalsSchema.describe(
    "The sums of the planned numbers of the workouts planned, skipped and missed alike; a number a workout lacks counts as 0",
  ),
  completed: calendarTotalsSchema.describe(
    "The sums over the activities done: moving time (timer_s, else elapsed_s), distance_m and load_tss; a number an activity lacks counts as 0",
  ),
});

export const calendarActivitySchema = z.object({
  id: activityId,
  sport: z.string().nullable(),
  indoor: z.boolean().nullable(),
  name: z.string().nullable(),
  startedAt: z.date().nullable(),
  seconds: z.number().nullable().describe("Moving time: timer_s, else elapsed_s"),
  meters: z.number().nullable().describe("distance_m"),
  load: z.number().nullable().describe("load_tss, once the analysis has it"),
});

export const calendarDaySchema = z.object({
  day: settingDaySchema,
  planned: z.array(plannedWorkoutSchema).describe("By position, then id"),
  activities: z
    .array(calendarActivitySchema)
    .describe(
      "The activities done that day, by their localDay, one per workout recorded (its primary), by start",
    ),
  totals: plannedAgainstCompletedSchema,
});

export const calendarWeekSchema = z.object({
  start: settingDaySchema.describe("Its Monday"),
  totals: plannedAgainstCompletedSchema.describe(
    "Over all seven days, also those outside the range",
  ),
});

const unauthorized = { UNAUTHORIZED: {} };

const plannedNotFound = { NOT_FOUND: { status: 404, message: "No such planned workout" } };

const plannedDeleted = {
  PLANNED_WORKOUT_DELETED: {
    status: 410,
    message: "The planned workout was deleted, and a deleted planned workout stays deleted",
    data: plannedDeletionSchema,
  },
};

const editedInTheFuture = {
  EDITED_IN_THE_FUTURE: { status: 422, message: "updatedAt is later than the server's clock" },
};

const dayFull = {
  DAY_FULL: {
    status: 422,
    message: `A day can hold at most ${MAX_PLANNED_PER_DAY} planned workouts`,
  },
};

const workoutTooLarge = {
  WORKOUT_TOO_LARGE: { status: 413, message: "The embedded workout is too large" },
};

const placement = {
  day: settingDaySchema,
  position: z
    .number()
    .finite()
    .describe(
      "Where it goes among the day's planned workouts, lowest first. Pick a number between its neighbours' to put it between them",
    ),
};

const conflictRule =
  "A planned workout has three parts, each kept by its own last edit: what it is (put), where it is (move) and whether it is skipped (skip). An edit replaces its part when its updatedAt is later than that part's last edit, so a device that edited offline sends its edits when it is back, and two devices editing different parts both keep their edit. A deleted planned workout stays deleted. The response is what the server holds afterwards";

export const plannedWorkoutsContract = {
  get: oc
    .route({ method: "GET", path: "/planned-workouts/{id}" })
    .errors({ ...unauthorized, ...plannedNotFound, ...plannedDeleted })
    .input(z.object({ id: plannedWorkoutIdSchema }))
    .output(plannedWorkoutSchema),
  put: oc
    .route({
      method: "POST",
      path: "/planned-workouts/{id}",
      description: `Plan a workout, note or rest day on a day, or change what an existing one is. day and position place a new one; for an existing one they are ignored, so a replayed plan does not undo a move. ${conflictRule}`,
    })
    .errors({
      ...unauthorized,
      ...plannedDeleted,
      ...editedInTheFuture,
      ...dayFull,
      ...workoutTooLarge,
    })
    .input(
      z.object({
        id: plannedWorkoutIdSchema,
        ...placement,
        content: plannedContentSchema,
        planId: planIdSchema.nullable().default(null),
        updatedAt: editedAt,
      }),
    )
    .output(plannedWorkoutSchema),
  move: oc
    .route({
      method: "POST",
      path: "/planned-workouts/{id}/move",
      description: `Move a planned workout to another day or place within its day. Its planned numbers are worked out again with the thresholds of the new day. ${conflictRule}`,
    })
    .errors({
      ...unauthorized,
      ...plannedNotFound,
      ...plannedDeleted,
      ...editedInTheFuture,
      ...dayFull,
    })
    .input(z.object({ id: plannedWorkoutIdSchema, ...placement, updatedAt: editedAt }))
    .output(plannedWorkoutSchema),
  skip: oc
    .route({
      method: "POST",
      path: "/planned-workouts/{id}/skip",
      description: `Mark a planned workout skipped, with an optional reason, or no longer skipped. ${conflictRule}`,
    })
    .errors({ ...unauthorized, ...plannedNotFound, ...plannedDeleted, ...editedInTheFuture })
    .input(
      z.object({
        id: plannedWorkoutIdSchema,
        skipped: z
          .object({ reason: text.max(500).nullable() })
          .nullable()
          .describe("null to take the skip back"),
        updatedAt: editedAt,
      }),
    )
    .output(plannedWorkoutSchema),
  delete: oc
    .route({
      method: "DELETE",
      path: "/planned-workouts/{id}",
      description:
        "Delete a planned workout. It stays deleted: a later edit from a device that has not heard yet is refused with PLANNED_WORKOUT_DELETED",
    })
    .errors(unauthorized)
    .input(z.object({ id: plannedWorkoutIdSchema }))
    .output(plannedDeletionSchema),
  changes: oc
    .route({
      method: "GET",
      path: "/planned-workouts/changes",
      description:
        "Every planned workout written or deleted since the cursor, for a device that keeps a copy of the calendar, such as the app playing today's workout offline",
    })
    .errors(unauthorized)
    .input(z.object({ since: z.string().regex(/^\d+$/).optional() }))
    .output(
      z.object({
        planned: z.array(plannedWorkoutSchema),
        deleted: z.array(plannedDeletionSchema),
        cursor: z.string().describe("Pass as since to get only what changes after this read"),
      }),
    ),
};

export const calendarContract = {
  range: oc
    .route({
      method: "GET",
      path: "/calendar",
      description:
        "The athlete's calendar from one day through another: each day's planned workouts and the activities done, with totals of planned against completed time, distance and load for each day and for each Monday-to-Sunday week the range touches. Days are the athlete's calendar days: an activity is on its localDay, and today is where the athlete's time zone says. One request serves a month or a week view",
    })
    .errors(unauthorized)
    .input(
      z
        .object({ from: settingDaySchema, through: settingDaySchema })
        .refine(({ from, through }) => daysApart(from, through) >= 0, {
          message: "through comes before from",
        })
        .refine(({ from, through }) => daysApart(from, through) < MAX_CALENDAR_DAYS, {
          message: `At most ${MAX_CALENDAR_DAYS} days`,
        }),
    )
    .output(
      z.object({
        today: settingDaySchema.describe("Today in the athlete's time zone"),
        days: z.array(calendarDaySchema).describe("One for every day from from through through"),
        weeks: z.array(calendarWeekSchema),
      }),
    ),
};

export type PlannedWorkout = z.infer<typeof plannedWorkoutSchema>;
export type PlannedContent = z.infer<typeof plannedContentSchema>;
export type PlannedNumbers = z.infer<typeof plannedNumbersSchema>;
export type PlannedWorkoutSource = z.infer<typeof plannedWorkoutSourceSchema>;
export type CalendarDay = z.infer<typeof calendarDaySchema>;
export type CalendarActivity = z.infer<typeof calendarActivitySchema>;
export type CalendarTotals = z.infer<typeof calendarTotalsSchema>;
