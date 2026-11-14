import { oc } from "@orpc/contract";
import { z } from "zod";

import { settingDaySchema } from "./settings.ts";

export const MAX_TRAINING_LOAD_DAYS = 3 * 366;

const activityId = z.string().regex(/^[0-9a-f]{64}$/);

const daysApart = (from: string, through: string) =>
  (Date.parse(`${through}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

export const loadSourceSchema = z
  .enum(["power", "pace", "heart_rate"])
  .describe("The stress score the load came from");

export const loadedActivitySchema = z.object({
  id: activityId,
  stress: z.number().describe("Its load_tss"),
  source: loadSourceSchema,
});

export const trainingDaySchema = z.object({
  day: settingDaySchema,
  stress: z.number().describe("The day's load: the sum of its activities' load_tss"),
  fitness: z.number().describe("Chronic training load, a 42-day exponential average of stress"),
  fatigue: z.number().describe("Acute training load, a 7-day exponential average of stress"),
  form: z.number().describe("Fitness minus fatigue"),
  activities: z.array(loadedActivitySchema).describe("The activities that made the day's stress"),
});

const periodShape = {
  from: settingDaySchema,
  through: settingDaySchema.optional().describe("The last day, by default the athlete's today"),
};

const inOrder = ({ from, through }: { from: string; through?: string | undefined }) =>
  through === undefined || daysApart(from, through) >= 0;

export const bestPowerSchema = z.object({
  durationSeconds: z.number().int(),
  watts: z.number(),
  activityId,
  day: settingDaySchema,
});

export const bestEffortSchema = z.object({
  name: z.string().describe("400m, 1km, mile, 5km, 10km, half_marathon or marathon"),
  seconds: z.number(),
  activityId,
  day: settingDaySchema,
});

const analysesDue = z
  .number()
  .int()
  .min(0)
  .describe(
    "How many of the athlete's activities that can change these numbers have analysisDue set: new uploads, and after a settings change every activity until the server has checked it. While it is above 0 the numbers may still change; 0 means they are final until the athlete's settings or activities change",
  );

const unauthorized = { UNAUTHORIZED: {} };

export const trainingContract = {
  load: oc
    .route({
      method: "GET",
      path: "/training/load",
      description:
        "Fitness, fatigue and form for each day of a period, across all sports. A day is a calendar day of the athlete: each activity counts on the day it was done (its localDay), and today ends where the athlete's time zone says. Each workout counts once, by its primary activity, and only activities with a load_tss count. Fitness and fatigue build up from the athlete's first loaded day, so they are right on the first day asked for",
    })
    .errors(unauthorized)
    .input(
      z
        .object(periodShape)
        .refine(inOrder, { message: "through comes before from" })
        .refine(
          ({ from, through }) =>
            through === undefined || daysApart(from, through) < MAX_TRAINING_LOAD_DAYS,
          { message: `At most ${MAX_TRAINING_LOAD_DAYS} days` },
        ),
    )
    .output(
      z.object({
        today: settingDaySchema.describe("Today in the athlete's time zone"),
        days: z.array(trainingDaySchema).describe("One for every day from from through through"),
        analysesDue,
      }),
    ),
  bests: oc
    .route({
      method: "GET",
      path: "/training/bests",
      description:
        "The athlete's bests across activities done in a period: the best average power over each duration of the power curve, and the fastest time over each standard distance, each with the activity it came from. Each workout counts once, by its primary activity",
    })
    .errors(unauthorized)
    .input(
      z
        .object({
          ...periodShape,
          sport: z
            .string()
            .min(1)
            .max(64)
            .optional()
            .describe("Only activities of this sport, such as cycling or running"),
        })
        .refine(inOrder, { message: "through comes before from" }),
    )
    .output(
      z.object({
        powerCurve: z.array(bestPowerSchema).describe("Shortest duration first"),
        bestEfforts: z.array(bestEffortSchema).describe("Shortest distance first"),
        analysesDue,
      }),
    ),
};

export type TrainingDay = z.infer<typeof trainingDaySchema>;
export type BestPower = z.infer<typeof bestPowerSchema>;
export type BestEffort = z.infer<typeof bestEffortSchema>;
