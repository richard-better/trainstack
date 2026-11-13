import { oc } from "@orpc/contract";
import { z } from "zod";

export const MAX_SETTING_WRITES = 100;

const word = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, "lowercase words joined by underscores");

export const settingDaySchema = z.iso
  .date()
  .describe("A day in the athlete's own calendar, as YYYY-MM-DD, with no time zone");

const sport = word.describe("A sport, such as cycling, running or swimming");
const sportOrEvery = sport
  .nullable()
  .describe("The sport this applies to, or null for the default every sport without its own uses");
const metric = z.enum(["heart_rate", "power", "pace"]);
const threshold = word.describe(
  "Such as ftp, lactate_threshold_heart_rate, max_heart_rate, resting_heart_rate, aerobic_threshold_heart_rate, aerobic_threshold_power or threshold_pace. Heart rate is in beats per minute, power in watts, pace in seconds per 1000 m running and per 100 m swimming, so a swimmer's critical swim speed is their threshold_pace",
);
const zoneModel = word.describe(
  "How zones follow from thresholds, such as coggan_6, percent_of_max, karvonen, friel_running_pace or critical_swim_speed",
);
const limits = z
  .array(z.number().int())
  .describe(
    "The last value in each zone but the top one. Pace zones run from slow to fast, so their limits fall",
  );

export const settingKeySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("threshold"), sport: sportOrEvery, threshold }),
  z.object({ kind: z.literal("zones"), sport: sportOrEvery, metric }),
  z.object({ kind: z.literal("own_zones"), sport, metric }),
  z.object({ kind: z.literal("sport"), sport }),
  z.object({ kind: z.literal("weight") }),
  z.object({ kind: z.literal("threshold_test"), id: z.uuid() }),
]);

export const settingChangeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("threshold"),
      sport: sportOrEvery,
      threshold,
      value: z.number().int().nullable().describe("null clears the threshold from this day on"),
    })
    .describe("A threshold, from this day until the next change to it"),
  z
    .object({
      kind: z.literal("zones"),
      sport: sportOrEvery,
      metric,
      model: zoneModel,
      customLimits: limits
        .nullable()
        .describe("The athlete's own zone boundaries, which replace the model's while set"),
    })
    .describe("How a metric's zones are drawn"),
  z
    .object({ kind: z.literal("own_zones"), sport, metric, own: z.boolean() })
    .describe(
      "Whether a listed sport keeps its own heart rate or power zones, starting as a copy of the default, instead of using the default",
    ),
  z
    .object({ kind: z.literal("sport"), sport, listed: z.boolean() })
    .describe(
      "Whether the sport is in the athlete's settings. Listing running or swimming gives it pace zones",
    ),
  z.object({ kind: z.literal("weight"), kg: z.number().min(30).max(200) }),
  z
    .object({
      kind: z.literal("threshold_test"),
      id: z.uuid(),
      sport: sportOrEvery,
      threshold,
      protocol: word.describe("Such as ramp, twenty_minute, eight_minute, hour, detected or other"),
      value: z.number().int(),
      activityId: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .nullable()
        .describe("The activity the test was ridden or detected in"),
    })
    .describe("A test result. It changes no threshold by itself"),
]);

const updatedAt = z
  .date()
  .describe(
    "When the athlete made this edit, by the device's clock. Of two writes to the same setting and day, the later one wins",
  );

export const settingEntrySchema = z.object({
  day: settingDaySchema,
  change: settingChangeSchema,
  updatedAt,
});

export const settingRemovalSchema = z.object({
  day: settingDaySchema,
  key: settingKeySchema,
  updatedAt,
});

export const settingWriteSchema = z.union([
  settingEntrySchema,
  settingRemovalSchema.extend({ remove: z.literal(true) }),
]);

const historySchema = z.object({
  entries: z.array(settingEntrySchema).describe("Ordered by day"),
  removed: z
    .array(settingRemovalSchema)
    .describe("Entries removed, kept so a device can drop its copy"),
  cursor: z.string().describe("Pass as since to get only what changes after this read"),
});

export const zoneSchema = z.object({
  index: z.number().int(),
  label: z.string(),
  name: z.string(),
  start: z.number().int().nullable(),
  end: z.number().int().nullable(),
  intensity: z.enum(["easy", "moderate", "hard"]),
});

export const zoneSetSchema = z.object({
  model: zoneModel,
  metric,
  descending: z.boolean(),
  limits: z.array(z.number().int()),
  zones: z.array(zoneSchema),
});

export const metricSettingsSchema = z.object({
  model: zoneModel,
  customLimits: limits.nullable(),
  thresholds: z.record(z.string(), z.number().int()),
  zones: zoneSetSchema.nullable().describe("null until the thresholds the model needs are set"),
  missingThresholds: z.array(threshold),
});

const metricMap = <T extends z.ZodType>(value: T) => z.partialRecord(metric, value);

export const athleteSettingsSchema = z.object({
  day: settingDaySchema.nullable().describe("The day these settings held on, or null for now"),
  weightKg: z.number().nullable(),
  defaults: metricMap(metricSettingsSchema).describe("Used by every sport without its own"),
  sports: z
    .record(
      sport,
      metricMap(
        metricSettingsSchema.extend({
          usesDefault: z
            .boolean()
            .describe("True while the sport uses the default for this metric"),
        }),
      ),
    )
    .describe("Each listed sport, with every metric it has"),
});

const unauthorized = { UNAUTHORIZED: {} };

export const settingsContract = {
  get: oc
    .route({ method: "GET", path: "/settings" })
    .errors(unauthorized)
    .input(z.object({ day: settingDaySchema.optional() }))
    .output(athleteSettingsSchema),
  zones: oc
    .route({ method: "GET", path: "/settings/zones" })
    .errors(unauthorized)
    .input(z.object({ day: settingDaySchema, sport: sport.optional() }))
    .output(
      z.object({
        day: settingDaySchema,
        sport: sport.nullable(),
        zones: metricMap(zoneSetSchema).describe("Only the metrics with zones on that day"),
      }),
    ),
  history: oc
    .route({ method: "GET", path: "/settings/history" })
    .errors(unauthorized)
    .input(z.object({ since: z.string().regex(/^\d+$/).optional() }))
    .output(historySchema),
  write: oc
    .route({ method: "POST", path: "/settings/history" })
    .errors({
      ...unauthorized,
      INVALID_SETTING: {
        status: 422,
        message: "A write is not a valid setting",
        data: z.object({ index: z.number().int(), reason: z.string() }),
      },
    })
    .input(z.object({ writes: z.array(settingWriteSchema).min(1).max(MAX_SETTING_WRITES) }))
    .output(historySchema.describe("What each written setting and day now holds")),
};

export type SettingChange = z.infer<typeof settingChangeSchema>;
export type SettingKey = z.infer<typeof settingKeySchema>;
export type SettingEntry = z.infer<typeof settingEntrySchema>;
export type SettingRemoval = z.infer<typeof settingRemovalSchema>;
export type SettingWrite = z.infer<typeof settingWriteSchema>;
export type AthleteSettings = z.infer<typeof athleteSettingsSchema>;
export type ZoneSetOutput = z.infer<typeof zoneSetSchema>;
