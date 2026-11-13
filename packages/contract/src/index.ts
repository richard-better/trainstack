import { oc, type ContractRouterClient } from "@orpc/contract";
import { z } from "zod";

import { settingsContract } from "./settings";

export * from "./settings";

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
  "The sport, such as cycling, indoor_cycling, running, swimming, strength or bouldering",
);

export const activitySourceSchema = slug.describe(
  "Where the activity came from, such as trainstack, apple_health, strava, upload or coros",
);

export const activityFileFormatSchema = z.enum(["fit", "gpx", "tcx"]);

export const activitySchema = z.object({
  id: activityIdSchema,
  source: activitySourceSchema,
  sourceId: z.string().nullable(),
  sport: activitySportSchema.nullable(),
  name: z.string().nullable(),
  startedAt: z.date().nullable(),
  file: z.object({ format: activityFileFormatSchema, size: z.number().int() }).nullable(),
  summarizedAt: z
    .date()
    .nullable()
    .describe("When the server derived the summary from the file; null while it has not yet"),
  statistics: z
    .record(z.string(), z.number())
    .describe("Numbers that sum up the activity, such as distance_m or average_power_w"),
  createdAt: z.date(),
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
};

export type AppContractClient = ContractRouterClient<typeof appContract>;
export type Activity = z.infer<typeof activitySchema>;
export type ActivityDetail = z.infer<typeof activityDetailSchema>;
export type ActivityEvent = z.infer<typeof activityEventSchema>;
