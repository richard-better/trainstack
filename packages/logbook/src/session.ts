import { z } from "zod";

import { boulderingDetailSchema } from "./bouldering.ts";
import { strengthDetailSchema } from "./strength.ts";

export const MAX_SESSION_SECONDS = 12 * 60 * 60;

export const sessionDetailSchema = z.discriminatedUnion("sport", [
  strengthDetailSchema,
  boulderingDetailSchema,
]);
export type SessionDetail = z.infer<typeof sessionDetailSchema>;

export type LoggedSport = SessionDetail["sport"];
export const loggedSports = ["strength", "bouldering"] as const satisfies readonly LoggedSport[];

export const sessionRpeSchema = z
  .number()
  .min(0)
  .max(10)
  .refine((value) => Number.isInteger(value * 2), "in steps of a half")
  .describe(
    "Session RPE: how hard the whole session was, on Foster's 0 to 10 scale (0 rest, 3 moderate, 5 hard, 7 very hard, 10 maximal), rated once it is over",
  );

export const loggedSessionSchema = z.object({
  startedAt: z.date(),
  durationSeconds: z.number().int().min(60).max(MAX_SESSION_SECONDS),
  name: z.string().trim().min(1).max(200).nullable(),
  notes: z.string().trim().max(4000).nullable(),
  rpe: sessionRpeSchema.nullable(),
  detail: sessionDetailSchema,
});
export type LoggedSession = z.infer<typeof loggedSessionSchema>;
