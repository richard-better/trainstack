import { oc } from "@orpc/contract";
import {
  customExerciseSchema,
  equipmentSchema,
  exerciseIdSchema,
  exerciseMeasureSchema,
  fontGradeSchema,
  gradeSchema,
  loggedSessionSchema,
  massUnitSchema,
  muscleSchema,
  recordKinds,
  vGradeSchema,
} from "@trainstack/logbook";
import { z } from "zod";

import { settingDaySchema } from "./settings.ts";

const activityId = z.string().regex(/^[0-9a-f]{64}$/);

export const loggedSessionIdSchema = z
  .uuid()
  .describe(
    "Chosen by the client that logs the session, so a phone in a gym without signal can log it and a replayed write changes nothing",
  );

export const loggedSportSchema = z.enum(["strength", "bouldering"]);

const editedAt = z
  .date()
  .describe(
    "When the athlete made this edit, by the device's clock. Of two writes to the same session, the later editedAt wins, whichever arrives last; of two at the same moment, the server keeps the same one in either order. A write may be at most ten minutes ahead of the server's clock",
  );

export const gradeValueSchema = z
  .object({
    grade: gradeSchema,
    circuit: z.string().nullable().describe("The circuit's name, for a grade given as a colour"),
    font: fontGradeSchema.nullable().describe("As a Font grade, by the stated table"),
    v: vGradeSchema.nullable().describe("As a V grade, by the stated table"),
  })
  .describe("A grade as the athlete gave it, with what it converts to where it converts");

export const loggedSummarySchema = z.discriminatedUnion("sport", [
  z.object({
    sport: z.literal("strength"),
    exercises: z.number().int(),
    sets: z.number().int().describe("Sets other than warm-ups"),
    reps: z.number().int(),
    volumeKg: z
      .number()
      .nullable()
      .describe(
        "Reps times load over sets other than warm-ups. Bodyweight sets count the athlete's weight of the day, and none when it is not set",
      ),
    unit: massUnitSchema.describe("The unit the athlete entered most weights in"),
  }),
  z.object({
    sport: z.literal("bouldering"),
    problems: z.number().int(),
    tops: z.number().int().describe("Problems flashed, sent or repeated"),
    sends: z.number().int().describe("First ascents: flashes and sends"),
    flashes: z.number().int(),
    attempts: z.number().int(),
    hardestTop: gradeValueSchema.nullable(),
    hardestFlash: gradeValueSchema.nullable(),
  }),
]);

export const activityLoggedSchema = z
  .object({ sessionId: loggedSessionIdSchema, summary: loggedSummarySchema })
  .nullable()
  .describe(
    "For an activity the athlete logged by hand, such as a strength or bouldering session, its session and what it sums up to; null for a recorded activity. Read the whole session with logbook.get",
  );

export const exerciseNumbersSchema = z.object({
  exerciseId: exerciseIdSchema,
  sets: z.number().int(),
  reps: z.number().int(),
  volumeKg: z.number().nullable(),
  heaviestKg: z.number().nullable(),
  estimatedOneRepMaxKg: z
    .number()
    .nullable()
    .describe("Epley: load × (1 + reps / 30), the best over sets of 1 to 12 reps"),
  mostReps: z.number().int().nullable(),
  longestSeconds: z.number().nullable(),
});

export const personalRecordSchema = z.object({
  exerciseId: exerciseIdSchema,
  kind: z.enum(recordKinds),
  value: z.number(),
  previous: z.number().describe("The best of every earlier session of the exercise"),
});

export const sessionLoadSchema = z
  .object({
    sessionRpeLoad: z.number().describe("Foster's session RPE load: RPE times minutes"),
    stressScore: z
      .number()
      .describe(
        "An estimate on the TSS scale, from Friel's TSS per hour for each RPE times hours. It is the session's load_tss",
      ),
  })
  .nullable()
  .describe("Null when the session has no RPE, so it adds no load");

export const storedSessionSchema = z.object({
  id: loggedSessionIdSchema,
  activityId,
  localDay: settingDaySchema,
  session: loggedSessionSchema,
  editedAt: z.date(),
  createdAt: z.date(),
  load: sessionLoadSchema,
  bodyMassKg: z
    .number()
    .nullable()
    .describe("The athlete's weight on the session's day, which bodyweight sets count"),
  numbers: z.discriminatedUnion("sport", [
    z.object({
      sport: z.literal("strength"),
      exercises: z.array(exerciseNumbersSchema).describe("One per exercise, in order"),
      records: z
        .array(personalRecordSchema)
        .describe(
          "Records this session set: an exercise's number above every session of it that started earlier. A first session sets none",
        ),
    }),
    z.object({ sport: z.literal("bouldering") }),
  ]),
  summary: loggedSummarySchema,
});

export const storedExerciseSchema = customExerciseSchema.extend({
  editedAt: z.date(),
  createdAt: z.date(),
});

export const catalogueExerciseSchema = z.object({
  id: z.string(),
  name: z.string(),
  equipment: equipmentSchema,
  primaryMuscles: z.array(muscleSchema),
  secondaryMuscles: z.array(muscleSchema),
  measure: exerciseMeasureSchema,
  bodyweight: z.boolean(),
});

export const exerciseUseSchema = z.object({
  exerciseId: exerciseIdSchema,
  sessions: z.number().int(),
  lastDay: settingDaySchema,
});

export const strengthPointSchema = z.object({
  sessionId: loggedSessionIdSchema,
  activityId,
  day: settingDaySchema,
  numbers: exerciseNumbersSchema,
});

export const boulderingPointSchema = z.object({
  sessionId: loggedSessionIdSchema,
  activityId,
  day: settingDaySchema,
  venue: z.string().nullable(),
  problems: z.number().int(),
  tops: z.number().int(),
  sends: z.number().int(),
  attempts: z.number().int(),
  hardestTop: gradeValueSchema.nullable(),
});

export const pyramidScaleSchema = z
  .union([z.enum(["font", "v"]), z.object({ circuit: z.string().min(1).max(80) })])
  .describe("font or v, or a circuit by its name, whose colours the pyramid then counts in");

export const pyramidStepSchema = z.object({
  grade: z.string(),
  flashes: z.number().int(),
  sends: z.number().int(),
  projects: z.number().int(),
  attempts: z.number().int(),
});

const period = {
  from: settingDaySchema,
  through: settingDaySchema,
};

const sessionDeleted = {
  SESSION_DELETED: {
    status: 410,
    message: "The session was deleted, so it is not accepted again",
    data: z.object({ id: loggedSessionIdSchema, deletedAt: z.date() }),
  },
};

const unauthorized = { UNAUTHORIZED: {} };
const notFound = { NOT_FOUND: { status: 404, message: "No such session" } };
const editedInTheFuture = {
  EDITED_IN_THE_FUTURE: { status: 422, message: "editedAt is later than the server's clock" },
};

export const MAX_PROGRESS_DAYS = 3 * 366;

export const logbookContract = {
  put: oc
    .route({
      method: "PUT",
      path: "/logbook/sessions/{id}",
      description:
        "Log a strength or bouldering session, or change one. The session is an activity with no file, of its sport, on the day it started in the athlete's time zone, in the same lists, days, calendar and training load as every other. A file of the same session from a watch links to it by the duplicate rules, and the logged session stands for the workout unless the athlete chooses the file. A deleted session stays deleted",
    })
    .errors({
      ...unauthorized,
      ...sessionDeleted,
      ...editedInTheFuture,
      UNKNOWN_EXERCISE: {
        status: 422,
        message: "An exercise is neither in the catalogue nor one of the athlete's own",
        data: z.object({ exerciseId: z.string() }),
      },
    })
    .input(z.object({ id: loggedSessionIdSchema, session: loggedSessionSchema, editedAt }))
    .output(storedSessionSchema),
  get: oc
    .route({ method: "GET", path: "/logbook/sessions/{id}" })
    .errors({ ...unauthorized, ...notFound, ...sessionDeleted })
    .input(z.object({ id: loggedSessionIdSchema }))
    .output(storedSessionSchema),
  latest: oc
    .route({
      method: "GET",
      path: "/logbook/latest",
      description:
        "The athlete's latest session of a sport by start, to log the next one from, or null",
    })
    .errors(unauthorized)
    .input(
      z.object({
        sport: loggedSportSchema,
        exerciseId: exerciseIdSchema
          .optional()
          .describe("Only a session with this exercise, to repeat its sets"),
      }),
    )
    .output(storedSessionSchema.nullable()),
  delete: oc
    .route({
      method: "DELETE",
      path: "/logbook/sessions/{id}",
      description:
        "Delete a session and its activity. A device that writes it again is refused, as for a deleted activity. Deleting its activity deletes the session too",
    })
    .errors(unauthorized)
    .input(z.object({ id: loggedSessionIdSchema }))
    .output(z.object({ id: loggedSessionIdSchema, deletedAt: z.date() })),
  exercises: oc
    .route({
      method: "GET",
      path: "/logbook/exercises",
      description:
        "The exercise catalogue, the athlete's own exercises, and how often and how lately the athlete logged each",
    })
    .errors(unauthorized)
    .input(z.object({}))
    .output(
      z.object({
        catalogue: z.array(catalogueExerciseSchema),
        custom: z.array(storedExerciseSchema).describe("By name"),
        used: z.array(exerciseUseSchema).describe("The latest first"),
      }),
    ),
  putExercise: oc
    .route({
      method: "PUT",
      path: "/logbook/exercises/{id}",
      description:
        "Add one of the athlete's own exercises, or change it. Of two writes, the later editedAt wins",
    })
    .errors({ ...unauthorized, ...editedInTheFuture })
    .input(
      z.object({
        id: customExerciseSchema.shape.id,
        exercise: customExerciseSchema.omit({ id: true }),
        editedAt,
      }),
    )
    .output(storedExerciseSchema),
  strengthProgress: oc
    .route({
      method: "GET",
      path: "/logbook/progress/strength",
      description:
        "One exercise over a period: its numbers in each session that has it, oldest first, by the session's day",
    })
    .errors(unauthorized)
    .input(z.object({ exerciseId: exerciseIdSchema, ...period }))
    .output(
      z.object({
        points: z.array(strengthPointSchema),
        unit: massUnitSchema.describe("The unit the athlete entered this exercise in most"),
      }),
    ),
  boulderingProgress: oc
    .route({
      method: "GET",
      path: "/logbook/progress/bouldering",
      description:
        "Bouldering over a period: each session's numbers, oldest first, and the grade pyramid of its first ascents and projects in one scale",
    })
    .errors(unauthorized)
    .input(z.object({ ...period, scale: pyramidScaleSchema }))
    .output(
      z.object({
        sessions: z.array(boulderingPointSchema),
        pyramid: z.object({
          steps: z.array(pyramidStepSchema).describe("Hardest first"),
          ungraded: z
            .number()
            .int()
            .describe("Problems whose grade does not convert to the scale asked for"),
        }),
        circuits: z.array(z.string()).describe("The circuits the period's sessions used, by name"),
      }),
    ),
};

export type LoggedSummary = z.infer<typeof loggedSummarySchema>;
export type StoredSession = z.infer<typeof storedSessionSchema>;
export type StoredExercise = z.infer<typeof storedExerciseSchema>;
export type GradeValue = z.infer<typeof gradeValueSchema>;
export type StrengthPoint = z.infer<typeof strengthPointSchema>;
export type BoulderingPoint = z.infer<typeof boulderingPointSchema>;
export type PyramidScale = z.infer<typeof pyramidScaleSchema>;
