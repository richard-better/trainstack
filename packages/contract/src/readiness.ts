import { oc } from "@orpc/contract";
import {
  checkInBaseline,
  deepFormShare,
  easyIntensityBelow,
  fastRampPerWeek,
  hardDayShare,
  hardIntensityFrom,
  loadHistoryDays,
  maxTrainingWeight,
  recentIllnessDays,
} from "@trainstack/readiness";
import { z } from "zod";

import {
  bodyAreaSchema,
  checkInItems,
  illnessKindSchema,
  injuryTrainingSchema,
} from "./check-ins.ts";
import { plannedWorkoutIdSchema } from "./calendar.ts";
import { settingDaySchema } from "./settings.ts";

export const MAX_READINESS_DAYS = 92;

const daysApart = (from: string, through: string) =>
  (Date.parse(`${through}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

const percent = (share: number) => `${Math.round(share * 100)} %`;

export const readinessLevelSchema = z
  .enum(["ready", "fair", "low", "poor"])
  .describe(
    "ready: nothing points against the plan. fair: some strain, go easier on the hard parts. low: run down, keep the day easy. poor: strongly run down, or ill, or cannot train: rest",
  );

const effectSchema = z
  .enum(["lowers", "steady", "raises"])
  .describe("Which way this input moves readiness");

const weight = z
  .number()
  .int()
  .min(0)
  .describe("How much it counts against readiness: the weights add up to the level");

export const readinessReasonSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("ill"),
      illness: illnessKindSchema,
    }),
    z.object({
      kind: z.literal("injured"),
      area: bodyAreaSchema,
      training: injuryTrainingSchema,
    }),
    z.object({
      kind: z.literal("recently_ill"),
      lastDay: settingDaySchema,
      daysAgo: z.number().int().min(1),
    }),
    z.object({
      kind: z.literal("check_in"),
      item: z.enum(checkInItems),
      rating: z.number().int().min(1).max(5),
      usual: z
        .number()
        .describe(
          `The athlete's mean for this item over the ${checkInBaseline.days} days before, from at least ${checkInBaseline.minimum} check-ins and leaving out days marked ill, rounded to the nearest anchor; else 3, the scale's normal`,
        ),
      against: z
        .enum(["own", "scale"])
        .describe("Whether usual is the athlete's own or the scale's"),
      difference: z.number().describe("rating - usual"),
      effect: effectSchema,
      weight,
    }),
    z.object({
      kind: z.literal("form"),
      form: z.number().describe("Fitness minus fatigue at the end of the day before"),
      fitness: z.number(),
      share: z.number().describe("form ÷ fitness"),
      band: z
        .enum(["fresh", "neutral", "building", "deep"])
        .describe(`deep below ${percent(deepFormShare)} of fitness`),
      effect: effectSchema,
      weight,
    }),
    z.object({
      kind: z.literal("ramp"),
      perWeek: z
        .number()
        .describe(`How far fitness rose over the week before; counted above ${fastRampPerWeek}`),
      effect: effectSchema,
      weight,
    }),
    z.object({
      kind: z.literal("hard_days"),
      days: z
        .number()
        .int()
        .min(2)
        .describe(
          `Hard days in a row before this one, a hard day having stress at least ${hardDayShare} times the fitness going into it`,
        ),
      effect: effectSchema,
      weight,
    }),
  ])
  .describe(
    `One input that was read. Illness and injury come first and set the level no better than they allow: ill or cannot train, poor; trains less, low; ill in the ${recentIllnessDays} days before, fair. Training load together weighs at most ${maxTrainingWeight}`,
  );

export const readinessGapSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("no_check_in") }),
    z.object({
      kind: z.literal("short_baseline"),
      checkIns: z.number().int().min(0).describe(`Fewer than ${checkInBaseline.minimum}`),
    }),
    z.object({ kind: z.literal("no_training") }),
    z.object({
      kind: z.literal("short_training_history"),
      days: z
        .number()
        .int()
        .min(0)
        .describe(`Days since the first loaded day, fewer than the ${loadHistoryDays} load needs`),
    }),
    z.object({ kind: z.literal("little_training"), fitness: z.number() }),
  ])
  .describe("Something readiness could not read, and so did not count");

export const readinessActionSchema = z
  .enum(["as_planned", "ease", "swap_easy", "rest"])
  .describe(
    "as_planned: do it as planned. ease: keep it, but go easier on its hard parts or shorten it. swap_easy: do an easy session instead. rest: do not train",
  );

export const readinessSuggestionSchema = z
  .object({
    plannedId: plannedWorkoutIdSchema,
    intensity: z
      .enum(["easy", "moderate", "hard", "unknown"])
      .describe(
        `From the planned load and time: intensity factor √(load ÷ (100 × hours)) below ${easyIntensityBelow} easy, from ${hardIntensityFrom} hard, or a load of at least ${hardDayShare} times fitness hard. unknown without a planned load or time, treated as moderate`,
      ),
    action: readinessActionSchema,
    plannedLoad: z.number().nullable(),
    plannedSeconds: z.number().nullable(),
  })
  .describe(
    "What readiness would change about a workout still to do that day. A proposal only: nothing changes unless the athlete acts on it through the calendar",
  );

export const dayReadinessSchema = z.object({
  day: settingDaySchema,
  level: readinessLevelSchema.nullable().describe("Null when there is nothing to go on"),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe(
      "low without a check-in that day; medium with a short baseline or training history; high otherwise, and when the athlete is ill or cannot train, since that is their own word",
    ),
  reasons: z
    .array(readinessReasonSchema)
    .describe("Illness and injury first, then what lowers readiness most"),
  gaps: z.array(readinessGapSchema),
  basis: z.object({
    checkIn: z.boolean().describe("Whether the athlete checked in that day"),
    baselineCheckIns: z.number().int().min(0),
    trainingDays: z.number().int().min(0).describe("Days of training history before the day"),
    unmeasured: z
      .array(z.enum(["sleep", "resting_heart_rate", "hrv"]))
      .describe("What a device would measure and TrainStack does not have yet, so did not read"),
  }),
  suggestions: z.array(readinessSuggestionSchema).describe("By the day's planned order"),
});

const unauthorized = { UNAUTHORIZED: {} };

export const readinessContract = {
  range: oc
    .route({
      method: "GET",
      path: "/readiness",
      description: `How ready the athlete is each day, from their check-in against their own recent usual and their training load going into the day, with the reasons, what was missing, and a suggestion for each workout still to do. It is worked out when read, so it follows a new check-in, a changed plan or a re-analysed activity at once. Days after the athlete's today are left out. It reads no sleep, resting heart rate or HRV, and diagnoses nothing. The model, its weights and sources are in packages/readiness/README.md`,
    })
    .errors(unauthorized)
    .input(
      z
        .object({ from: settingDaySchema, through: settingDaySchema })
        .refine(({ from, through }) => daysApart(from, through) >= 0, {
          message: "through comes before from",
        })
        .refine(({ from, through }) => daysApart(from, through) < MAX_READINESS_DAYS, {
          message: `At most ${MAX_READINESS_DAYS} days`,
        }),
    )
    .output(
      z.object({
        today: settingDaySchema.describe("Today in the athlete's time zone"),
        days: z
          .array(dayReadinessSchema)
          .describe("One for every day from from through the earlier of through and today"),
      }),
    ),
};

export type DayReadiness = z.infer<typeof dayReadinessSchema>;
export type ReadinessReason = z.infer<typeof readinessReasonSchema>;
export type ReadinessSuggestion = z.infer<typeof readinessSuggestionSchema>;
export type ReadinessLevel = z.infer<typeof readinessLevelSchema>;
