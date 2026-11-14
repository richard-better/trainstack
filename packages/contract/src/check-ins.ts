import { oc } from "@orpc/contract";
import { z } from "zod";

import { settingDaySchema } from "./settings.ts";

export const MAX_CHECK_IN_DAYS = 3 * 366;
export const MAX_CHECK_IN_NOTE = 1000;

const daysApart = (from: string, through: string) =>
  (Date.parse(`${through}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

export const checkInItems = ["sleep", "energy", "soreness", "stress", "mood"] as const;

export const checkInAnchors = {
  sleep: ["Hardly slept", "Restless", "Normal", "Good", "Very restful"],
  energy: ["Exhausted", "More tired than normal", "Normal", "Fresh", "Very fresh"],
  soreness: ["Very sore", "Sorer than normal", "Normal", "Feeling good", "Feeling great"],
  stress: ["Highly stressed", "Stressed", "Normal", "Relaxed", "Very relaxed"],
  mood: ["Very low", "Low", "Normal", "Good", "Very positive"],
} as const satisfies Record<CheckInItem, readonly [string, string, string, string, string]>;

export type CheckInItem = (typeof checkInItems)[number];

const rating = (item: CheckInItem, what: string) =>
  z
    .number()
    .int()
    .min(1)
    .max(5)
    .nullable()
    .describe(
      `${what}, from 1 to 5: ${checkInAnchors[item].map((anchor, index) => `${index + 1} ${anchor.toLowerCase()}`).join(", ")}. Null when the athlete did not rate it`,
    );

export const checkInRatingsSchema = z
  .object({
    sleep: rating("sleep", "How the athlete slept last night, by their own judgement"),
    energy: rating(
      "energy",
      "How fresh or tired they feel, asked as energy so that higher is better like every other item",
    ),
    soreness: rating("soreness", "How their muscles feel"),
    stress: rating("stress", "How stressed or relaxed they feel"),
    mood: rating("mood", "Their mood"),
  })
  .describe(
    "The athlete's own ratings, each on the same 1 to 5 scale where 3 is normal for them and higher is better, after the wellness questionnaire of McLean and others (2010) with its middle made normal on every item. Each is what the athlete chose; nothing is filled in for them",
  );

export const illnessKindSchema = z
  .enum(["respiratory", "stomach", "fever", "other"])
  .describe(
    "respiratory: a cold, cough or sore throat. stomach: stomach or gut. fever: a fever or aching all over. other: anything else",
  );

export const bodyAreaSchema = z
  .enum([
    "head",
    "neck",
    "shoulder",
    "upper_arm",
    "elbow",
    "forearm",
    "wrist",
    "hand",
    "chest",
    "upper_back",
    "lower_back",
    "abdomen",
    "hip_groin",
    "thigh",
    "knee",
    "lower_leg",
    "ankle",
    "foot",
  ])
  .describe("Where it hurts, by the body areas of the IOC's 2020 consensus on injury in sport");

export const injuryTrainingSchema = z
  .enum(["full", "reduced", "none"])
  .describe(
    "What the injury lets the athlete do, after the OSTRC health questionnaire: full (trains fully), reduced (trains less or easier) or none (cannot train)",
  );

const noteSchema = z.string().trim().min(1).max(MAX_CHECK_IN_NOTE);

const checkInShape = {
  ratings: checkInRatingsSchema,
  illness: z
    .object({ kind: illnessKindSchema })
    .nullable()
    .describe("Set when the athlete says they are ill, with what kind"),
  injury: z
    .object({ area: bodyAreaSchema, training: injuryTrainingSchema })
    .nullable()
    .describe("Set when the athlete says they are injured, with where and what it lets them do"),
  note: noteSchema.nullable().describe("The athlete's own words about the day"),
};

const editedAt = z
  .date()
  .describe(
    "When the athlete made this edit, by the device's clock. Of two edits to the same day, the later one wins; of two at the same moment, the server picks the same one in either order",
  );

export const checkInSchema = z.object({
  day: settingDaySchema,
  ...checkInShape,
  updatedAt: editedAt,
});

const conflictRule =
  "One check-in per athlete per calendar day, kept whole: a write or a removal replaces the day's check-in when its updatedAt is later than the last edit to that day, so a device that checked in offline sends it when it is back, and a stale device never brings back what a later edit changed or removed. Of a write and a removal at the same moment the removal wins, and of two writes at the same moment the server keeps the same one in either order. The response is what the server holds afterwards";

const privacy =
  "Health data the athlete gives about themselves: only they can read it, it is in their account export, and deleting the account deletes it. The server stores what the athlete entered and infers nothing from it";

const unauthorized = { UNAUTHORIZED: {} };

const editedInTheFuture = {
  EDITED_IN_THE_FUTURE: { status: 422, message: "updatedAt is later than the server's clock" },
};

const dayNotYet = {
  DAY_NOT_YET: {
    status: 422,
    message: "A check-in is for today or a day before it, in the athlete's time zone",
  },
};

const held = z.object({
  day: settingDaySchema,
  checkIn: checkInSchema
    .nullable()
    .describe("The day's check-in the server holds, or null when the day has none"),
});

export const checkInsContract = {
  put: oc
    .route({
      method: "POST",
      path: "/check-ins/{day}",
      description: `Check in for a day: how the athlete slept and feels, whether they are ill or injured, and a note. Today or any day before it. ${conflictRule}. ${privacy}`,
    })
    .errors({ ...unauthorized, ...editedInTheFuture, ...dayNotYet })
    .input(checkInSchema)
    .output(held),
  remove: oc
    .route({
      method: "POST",
      path: "/check-ins/{day}/remove",
      description: `Remove a day's check-in. ${conflictRule}`,
    })
    .errors({ ...unauthorized, ...editedInTheFuture })
    .input(z.object({ day: settingDaySchema, updatedAt: editedAt }))
    .output(held),
  range: oc
    .route({
      method: "GET",
      path: "/check-ins",
      description: `The athlete's check-ins from one day through another, only the days that have one, by day, with today in the athlete's time zone. Days are the same calendar days as calendar.range and training.load, so a page lays them beside each other by day. ${privacy}`,
    })
    .errors(unauthorized)
    .input(
      z
        .object({ from: settingDaySchema, through: settingDaySchema })
        .refine(({ from, through }) => daysApart(from, through) >= 0, {
          message: "through comes before from",
        })
        .refine(({ from, through }) => daysApart(from, through) < MAX_CHECK_IN_DAYS, {
          message: `At most ${MAX_CHECK_IN_DAYS} days`,
        }),
    )
    .output(
      z.object({
        today: settingDaySchema.describe("Today in the athlete's time zone"),
        checkIns: z.array(checkInSchema).describe("Earliest day first"),
      }),
    ),
};

export type CheckIn = z.infer<typeof checkInSchema>;
export type CheckInRatings = z.infer<typeof checkInRatingsSchema>;
export type IllnessKind = z.infer<typeof illnessKindSchema>;
export type BodyArea = z.infer<typeof bodyAreaSchema>;
export type InjuryTraining = z.infer<typeof injuryTrainingSchema>;
