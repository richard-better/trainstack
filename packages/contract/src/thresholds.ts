import { oc } from "@orpc/contract";
import { z } from "zod";

import { settingDaySchema } from "./settings.ts";

const activityId = z.string().regex(/^[0-9a-f]{64}$/);

export const detectedThresholdSchema = z.enum([
  "ftp",
  "threshold_pace",
  "lactate_threshold_heart_rate",
  "max_heart_rate",
]);

export const thresholdEvidenceSchema = z.object({
  activityId,
  day: settingDaySchema,
  statistic: z
    .string()
    .describe("The activity statistic the estimate read, such as best_power_1200s_w"),
  value: z.number().describe("Its value, in the statistic's unit"),
});

export const thresholdSuggestionSchema = z.object({
  id: z.uuid().describe("Changes whenever the suggestion does, so accepting a stale one fails"),
  sport: z
    .string()
    .nullable()
    .describe(
      "The sport the threshold is set for, or null for the default every sport without its own zones uses, as in the settings",
    ),
  threshold: detectedThresholdSchema,
  value: z
    .number()
    .int()
    .describe("In the settings' units: watts, seconds per 1000 m, beats per minute"),
  current: z.number().int().nullable().describe("What the athlete has set today, or null"),
  method: z
    .enum([
      "critical_power",
      "twenty_minute",
      "hour",
      "riegel",
      "friel_thirty_minute",
      "observed_max",
    ])
    .describe("How the value was estimated, as packages/analysis documents"),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe(
      "Low means the efforts may not have been all-out, such as without a max heart rate the athlete has set",
    ),
  activityId: activityId.describe("The activity of the effort behind the value"),
  effortDay: settingDaySchema.describe("The day of that effort"),
  evidence: z.array(thresholdEvidenceSchema),
  signals: z
    .array(z.string())
    .describe(
      "What raised or lowered the confidence, such as heart_rate_maximal, curve_flat or efforts_stale",
    ),
  detectedAt: z.date(),
});

const unauthorized = { UNAUTHORIZED: {} };
const notFound = {
  NOT_FOUND: { status: 404, message: "No such suggestion: it was accepted, dismissed or changed" },
};

export const thresholdsContract = {
  suggestions: oc
    .route({
      method: "GET",
      path: "/thresholds/suggestions",
      description:
        "Thresholds detected from the athlete's activities that differ from what is set, or fill one that is not. The server keeps them current after it analyses activities; nothing changes a threshold until the athlete accepts",
    })
    .errors(unauthorized)
    .input(z.object({}))
    .output(z.object({ suggestions: z.array(thresholdSuggestionSchema) })),
  accept: oc
    .route({
      method: "POST",
      path: "/thresholds/suggestions/accept",
      description:
        "Set the suggested threshold, from today or from the day of the effort, and record it as a threshold_test with protocol detected, through the settings rules",
    })
    .errors({ ...unauthorized, ...notFound })
    .input(
      z.object({
        id: z.uuid(),
        from: z
          .enum(["today", "effort"])
          .describe("Whether the threshold holds from the athlete's today or the effort's day"),
      }),
    )
    .output(z.object({ day: settingDaySchema, testId: z.uuid() })),
  dismiss: oc
    .route({
      method: "POST",
      path: "/thresholds/suggestions/dismiss",
      description:
        "Hide the suggestion. The same evidence does not suggest it again; a new effort can",
    })
    .errors({ ...unauthorized, ...notFound })
    .input(z.object({ id: z.uuid() }))
    .output(z.object({})),
};

export type ThresholdSuggestion = z.infer<typeof thresholdSuggestionSchema>;
