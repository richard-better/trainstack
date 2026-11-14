import { oc, type ContractRouterClient } from "@orpc/contract";
import { z } from "zod";

import { settingDaySchema, settingsContract } from "./settings.ts";
import {
  activityStatistics,
  analysisStatistics,
  zoneTimeStatisticDescription,
} from "./statistics.ts";
import { trainingContract } from "./training.ts";
import { builtinWorkoutsContract, workoutListsContract, workoutsContract } from "./workouts.ts";

export * from "./settings.ts";
export * from "./statistics.ts";
export * from "./training.ts";
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

export const activityAnalysisErrorSchema = z
  .enum(["too_large", "failed"])
  .describe(
    "Why the server could not analyse the file: too_large (more records than one a second over the week the analysis reads) or failed (analysing it kept failing)",
  );

export const activityLocalDaySourceSchema = z
  .enum(["file", "time_zone", "athlete"])
  .describe(
    "What decided the activity's day: file (the local time the file records), time_zone (the athlete's time zone when the activity arrived) or athlete (the athlete set it)",
  );

export const duplicateActivitySchema = z.object({
  id: activityIdSchema,
  source: activitySourceSchema,
  sourceId: z.string().nullable(),
  startedAt: z.date().nullable(),
  file: z.object({ format: activityFileFormatSchema, size: z.number().int() }).nullable(),
  primary: z.boolean(),
});

export const activityRouteSchema = z
  .object({
    segments: z
      .array(z.string())
      .describe(
        "Google encoded polylines, precision 5, of the track while the timer ran. A new segment starts after a pause, a GPS gap of more than 60 seconds, or a jump faster than 100 m/s, so nothing draws a line across the map. Simplified with Douglas-Peucker to about 1e-4 degrees, and to at most 300 points across all segments",
      ),
    bounds: z
      .tuple([z.number(), z.number(), z.number(), z.number()])
      .describe("[west, south, east, north] in degrees, over every position kept"),
  })
  .nullable()
  .describe(
    "A simplified route of where the activity went, for a thumbnail or a first map, from the analysis of this activity's own file. Null for an indoor activity, for a file without positions, and until the file is analysed. Each copy of a duplicated workout has the route of its own file",
  );

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
  localDay: settingDaySchema
    .nullable()
    .describe(
      "The calendar day the activity belongs to, where it was done. It is fixed when the activity arrives: from the local time the file records, else from the athlete's time zone at that moment. Changing the time zone later moves no activity. Thresholds, daily load and bests all use this day",
    ),
  localDaySource: activityLocalDaySourceSchema.nullable(),
  statistics: z
    .record(z.string(), z.number())
    .describe(
      `Numbers that sum up the activity, named <what>_<unit>. From the file's summary: ${activityStatistics.map(({ name }) => name).join(", ")}. From the analysis: ${analysisStatistics.map(({ name }) => name).join(", ")}, and ${zoneTimeStatisticDescription}. More may come over time`,
    ),
  analyzedAt: z
    .date()
    .nullable()
    .describe(
      "When the server last analysed the file with the athlete's settings of the activity's day; null while it has not. It analyses again by itself when those settings change",
    ),
  analysisError: activityAnalysisErrorSchema.nullable(),
  analysisDue: z
    .boolean()
    .describe(
      "Whether the server has yet to analyse the activity as it stands: from when it arrives, after any change to the athlete's settings until it has checked whether the change touches this activity's day, and after the analysis itself improves. The scheduled job clears it, usually within minutes. While it is true, statistics from the analysis may be missing or out of date; once it is false they are final until the athlete's settings or the file change",
    ),
  route: activityRouteSchema,
  missingThresholds: z
    .array(z.string())
    .describe(
      "Thresholds the analysis needed on the activity's day but the athlete had not set, such as ftp, threshold_pace, resting_heart_rate, max_heart_rate or lactate_threshold_heart_rate. What needs none, such as work, the power curve and best efforts, is there without them",
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
  data: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .describe(
      "A lap's statistics, named as the activity's are. Once analysed, a lap also has normalized_power_w, work_kj and average_grade_adjusted_speed_mps where its data allows",
    ),
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
        startedAfter: z
          .date()
          .optional()
          .describe(
            "Only activities that started at or after this instant. An activity with no start time counts from when it was uploaded",
          ),
        startedBefore: z
          .date()
          .optional()
          .describe(
            "Only activities that started before this instant, the instant itself left out",
          ),
        query: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .optional()
          .describe(
            "Only activities whose name or sport contains this text, ignoring the case of A to Z. The name is the athlete's own, else the file's; the sport is the athlete's, else the file's, such as cycling or running",
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
  training: trainingContract,
  workouts: workoutsContract,
  builtinWorkouts: builtinWorkoutsContract,
  workoutLists: workoutListsContract,
};

export type AppContractClient = ContractRouterClient<typeof appContract>;
export type ActivityRoute = z.infer<typeof activityRouteSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type ActivityDetail = z.infer<typeof activityDetailSchema>;
export type DuplicateActivity = z.infer<typeof duplicateActivitySchema>;
export type ActivityEvent = z.infer<typeof activityEventSchema>;
export type ActivitySummaryError = z.infer<typeof activitySummaryErrorSchema>;
export type ActivityAnalysisError = z.infer<typeof activityAnalysisErrorSchema>;
export type ActivityLocalDaySource = z.infer<typeof activityLocalDaySourceSchema>;
