import { oc } from "@orpc/contract";
import { z } from "zod";

import { settingDaySchema } from "./settings.ts";

export const MAX_HEALTH_DAYS_PER_WRITE = 100;
export const MAX_HEALTH_DAYS_READ = 3 * 366;
export const LONGEST_NIGHT_SECONDS = 25 * 3600;

const daysApart = (from: string, through: string) =>
  (Date.parse(`${through}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

export const healthDaySourceSchema = z
  .enum(["apple_health"])
  .describe("Where the values were measured. apple_health: read from Apple Health by Ride");

const measuredShape = {
  sleepSeconds: z
    .number()
    .int()
    .min(0)
    .max(LONGEST_NIGHT_SECONDS)
    .nullable()
    .describe(
      "Time asleep in the night that ended on the morning of this day, in seconds, every source's sleep merged so no minute counts twice; null when nothing measured it. At most 25 hours, the longest noon to noon across a clock change",
    ),
  restingHeartRateBpm: z
    .number()
    .min(20)
    .max(250)
    .nullable()
    .describe("The day's resting heart rate, in beats per minute, as the device worked it out"),
  hrvMs: z
    .number()
    .min(1)
    .max(1000)
    .nullable()
    .describe(
      "The night's heart rate variability, in milliseconds: the mean of the readings the device took from noon the day before to noon on this day. Apple Health measures SDNN, so it is compared only with the athlete's own earlier values from the same source",
    ),
};

const editedAt = z
  .date()
  .describe(
    "When the device read these values, by its clock. Of two writes to the same day, the later one wins; of two at the same moment, the server keeps the same one in either order",
  );

export const healthDaySchema = z.object({
  day: settingDaySchema,
  source: healthDaySourceSchema,
  ...measuredShape,
  updatedAt: editedAt,
});

const privacy =
  "Health data measured by the athlete's own devices: only they can read it, it is in their account export, deleting the account deletes it, and the server never logs it";

const conflictRule =
  "One record per athlete, source and day, kept whole: a write replaces the day's record when its updatedAt is later, so a device that read Health offline sends it when it is back, and a stale device never overwrites a later read. A record with every value null says the day has nothing measured";

const unauthorized = { UNAUTHORIZED: {} };

const editedInTheFuture = {
  EDITED_IN_THE_FUTURE: { status: 422, message: "updatedAt is later than the server's clock" },
};

export const healthDaysContract = {
  put: oc
    .route({
      method: "POST",
      path: "/health-days",
      description: `Store measured sleep, resting heart rate and HRV for up to ${MAX_HEALTH_DAYS_PER_WRITE} days. Readiness reads them against the athlete's own usual. ${conflictRule}. The response holds what the server keeps for each day sent. ${privacy}`,
    })
    .errors({ ...unauthorized, ...editedInTheFuture })
    .input(
      z.object({
        days: z
          .array(healthDaySchema)
          .min(1)
          .max(MAX_HEALTH_DAYS_PER_WRITE)
          .refine(
            (days) =>
              new Set(days.map(({ day, source }) => `${source} ${day}`)).size === days.length,
            { message: "A day appears twice for one source" },
          ),
      }),
    )
    .output(z.object({ days: z.array(healthDaySchema).describe("Earliest day first") })),
  range: oc
    .route({
      method: "GET",
      path: "/health-days",
      description: `The athlete's measured days from one day through another, only the days that have a record, by day, on the same calendar days as readiness.range. ${privacy}`,
    })
    .errors(unauthorized)
    .input(
      z
        .object({ from: settingDaySchema, through: settingDaySchema })
        .refine(({ from, through }) => daysApart(from, through) >= 0, {
          message: "through comes before from",
        })
        .refine(({ from, through }) => daysApart(from, through) < MAX_HEALTH_DAYS_READ, {
          message: `At most ${MAX_HEALTH_DAYS_READ} days`,
        }),
    )
    .output(z.object({ days: z.array(healthDaySchema).describe("Earliest day first") })),
};

export type HealthDay = z.infer<typeof healthDaySchema>;
