import { oc, type ContractRouterClient } from "@orpc/contract";
import { z } from "zod";

import { settingsContract } from "./settings.ts";
import { activityStatistics } from "./statistics.ts";
import { builtinWorkoutsContract, workoutListsContract, workoutsContract } from "./workouts.ts";

export * from "./settings.ts";
export * from "./statistics.ts";
export * from "./workouts.ts";

export const MAX_ACTIVITY_FILE_BYTES = 25 * 1024 * 1024;

const slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, "lowercase words joined by underscores");

export const activityIdSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "the SHA-256 of the activity's file, in lowercase hex");

export const activitySportSchema = slug.describe(
  "The sport, such as cycling, running, swimming, strength or bouldering. Where it took place is `indoor`, not part of the sport; an upload's indoor_<sport> is read as <sport> done indoors",
);

export const activityIndoorSchema = z
  .boolean()
  .describe("Whether the activity took place indoors, such as on a trainer or a treadmill");

export const activitySourceSchema = slug.describe(
  "Where the activity came from, such as trainstack, apple_health, strava, upload or coros",
);

export const activityFileFormatSchema = z.enum(["fit", "gpx", "tcx"]);

export const activitySummaryErrorSchema = z
  .enum(["truncated", "corrupt", "no_activity", "too_large", "failed"])
  .describe(
    "Why the server could not derive the summary from the file: truncated (the file ends early), corrupt (it does not read as its format), no_activity (it reads, but holds no activity), too_large (more laps or sessions than an activity can have) or failed (summarising it kept failing)",
  );

export const duplicateActivitySchema = z.object({
  id: activityIdSchema,
  source: activitySourceSchema,
  sourceId: z.string().nullable(),
  startedAt: z.date().nullable(),
  file: z.object({ format: activityFileFormatSchema, size: z.number().int() }).nullable(),
  primary: z.boolean(),
});

export const activitySchema = z.object({
  id: activityIdSchema,
  source: activitySourceSchema,
  sourceId: z.string().nullable(),
  sport: activitySportSchema.nullable(),
  indoor: activityIndoorSchema.nullable(),
  name: z.string().nullable(),
  startedAt: z.date().nullable(),
  file: z.object({ format: activityFileFormatSchema, size: z.number().int() }).nullable(),
  summarizedAt: z
    .date()
    .nullable()
    .describe("When the server derived the summary from the file; null while it has not yet"),
  summaryError: activitySummaryErrorSchema.nullable(),
  statistics: z
    .record(z.string(), z.number())
    .describe(
      `Numbers that sum up the activity, named <what>_<unit>: ${activityStatistics.map(({ name }) => name).join(", ")}, and more over time`,
    ),
  createdAt: z.date(),
  primary: z
    .boolean()
    .describe(
      "Whether this activity stands for its workout. The same workout can arrive from several sources, such as Ride and a watch; the server links them, and exactly one of them is primary",
    ),
  duplicates: z
    .array(duplicateActivitySchema)
    .describe(
      "The other activities that recorded the same workout, each with its own file; empty when this is the only one",
    ),
});

export const activityEventSchema = z.object({
  type: slug.describe("Such as lap, pause or interval"),
  startedAt: z.date(),
  endedAt: z.date().nullable(),
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export const activityDetailSchema = activitySchema.extend({
  events: z.array(activityEventSchema),
});

const activityNotFound = { NOT_FOUND: { status: 404, message: "No such activity" } };

const activityDeleted = {
  ACTIVITY_DELETED: {
    status: 410,
    message: "The activity was deleted, so it is not accepted again",
    data: z.object({ id: activityIdSchema, deletedAt: z.date() }),
  },
};

const unauthorized = { UNAUTHORIZED: {} };

export const activitiesContract = {
  upload: oc
    .route({ method: "POST", path: "/activities", successStatus: 200 })
    .errors({
      ...unauthorized,
      ...activityDeleted,
      UNSUPPORTED_FILE: { status: 415, message: "The file is not a FIT, GPX or TCX file" },
    })
    .input(
      z.object({
        file: z.file().min(1).max(MAX_ACTIVITY_FILE_BYTES),
        source: activitySourceSchema,
        sourceId: z.string().min(1).max(128).optional(),
        sport: activitySportSchema.optional(),
        indoor: activityIndoorSchema.optional(),
        name: z.string().trim().min(1).max(200).optional(),
        startedAt: z.date().optional(),
      }),
    )
    .output(activitySchema),
  list: oc
    .route({ method: "GET", path: "/activities" })
    .errors(unauthorized)
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().optional(),
        onePerWorkout: z
          .boolean()
          .default(false)
          .describe(
            "List only the primary activity of each workout, so a workout recorded twice appears once. Without it the list holds every activity, as a client that syncs by id needs",
          ),
      }),
    )
    .output(
      z.object({
        activities: z.array(activitySchema),
        nextCursor: z.string().nullable(),
      }),
    ),
  get: oc
    .route({ method: "GET", path: "/activities/{id}" })
    .errors({ ...unauthorized, ...activityNotFound })
    .input(z.object({ id: activityIdSchema }))
    .output(activityDetailSchema),
  file: oc
    .route({ method: "GET", path: "/activities/{id}/file" })
    .errors({ ...unauthorized, ...activityNotFound })
    .input(z.object({ id: activityIdSchema }))
    .output(z.file()),
  makePrimary: oc
    .route({
      method: "POST",
      path: "/activities/{id}/primary",
      description:
        "Make this activity the one that stands for its workout. The choice holds when other copies arrive later and when activities are summarised again",
    })
    .errors({ ...unauthorized, ...activityNotFound })
    .input(z.object({ id: activityIdSchema }))
    .output(activitySchema),
  unlink: oc
    .route({
      method: "POST",
      path: "/activities/{id}/unlink",
      description:
        "Say this activity is not the same workout as the others it was linked to. It becomes a workout of its own, and is never linked to them again unless the athlete links it",
    })
    .errors({ ...unauthorized, ...activityNotFound })
    .input(z.object({ id: activityIdSchema }))
    .output(activitySchema),
  link: oc
    .route({
      method: "POST",
      path: "/activities/{id}/link",
      description:
        "Say this activity is the same workout as another, such as a file whose clock was wrong. Their workouts become one",
    })
    .errors({ ...unauthorized, ...activityNotFound })
    .input(z.object({ id: activityIdSchema, to: activityIdSchema }))
    .output(activitySchema),
  delete: oc
    .route({ method: "DELETE", path: "/activities/{id}" })
    .errors(unauthorized)
    .input(z.object({ id: activityIdSchema }))
    .output(z.object({ id: activityIdSchema, deletedAt: z.date() })),
};

export const appContract = {
  healthCheck: oc.output(z.literal("OK")),
  activities: activitiesContract,
  settings: settingsContract,
  workouts: workoutsContract,
  builtinWorkouts: builtinWorkoutsContract,
  workoutLists: workoutListsContract,
};

export type AppContractClient = ContractRouterClient<typeof appContract>;
export type Activity = z.infer<typeof activitySchema>;
export type ActivityDetail = z.infer<typeof activityDetailSchema>;
export type DuplicateActivity = z.infer<typeof duplicateActivitySchema>;
export type ActivityEvent = z.infer<typeof activityEventSchema>;
export type ActivitySummaryError = z.infer<typeof activitySummaryErrorSchema>;
