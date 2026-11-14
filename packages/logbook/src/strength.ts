import { z } from "zod";

import { exerciseIdSchema } from "./exercises.ts";
import { massSchema } from "./units.ts";

export const MAX_EXERCISES_PER_SESSION = 60;
export const MAX_SETS_PER_EXERCISE = 50;

export const setKindSchema = z
  .enum(["warm_up", "working", "drop", "failure"])
  .describe(
    "warm_up: a lighter set before the work, left out of every number. working: a set of the work. drop: a set straight after another with the weight lowered. failure: a set taken until no more reps would go",
  );
export type SetKind = z.infer<typeof setKindSchema>;

export const setLoadSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("weight"), weight: massSchema }),
    z.object({ kind: z.literal("bodyweight") }),
    z.object({ kind: z.literal("weighted"), added: massSchema }),
    z.object({ kind: z.literal("assisted"), assistance: massSchema }),
  ])
  .describe(
    "weight: the weight moved, as entered, so a dumbbell set holds the weight of one dumbbell. bodyweight: the athlete's body alone. weighted: the body with added weight, such as a belt. assisted: the body with assistance taken off, such as a band or a machine",
  );
export type SetLoad = z.infer<typeof setLoadSchema>;

const halfPoints = (low: number, high: number) =>
  z
    .number()
    .min(low)
    .max(high)
    .refine((value) => Number.isInteger(value * 2), "in steps of a half");

export const tempoSchema = z
  .string()
  .regex(
    /^[0-9X]-[0-9X]-[0-9X]-[0-9X]$/,
    "four counts in seconds, lowering-pause-lifting-pause, such as 3-1-X-0, X for as fast as possible",
  );

export const strengthSetSchema = z
  .object({
    kind: setKindSchema,
    reps: z.number().int().min(0).max(1000).nullable(),
    seconds: z
      .number()
      .min(0)
      .max(3600)
      .nullable()
      .describe("How long a hold lasted, for an exercise measured in time"),
    load: setLoadSchema,
    rpe: halfPoints(1, 10)
      .nullable()
      .describe(
        "Rate of perceived exertion of the set, 1 to 10 in halves, 10 the last rep possible",
      ),
    repsInReserve: z
      .number()
      .int()
      .min(0)
      .max(10)
      .nullable()
      .describe("How many more reps the athlete could have done"),
    tempo: tempoSchema.nullable(),
    restSeconds: z.number().int().min(0).max(3600).nullable().describe("The rest after the set"),
  })
  .refine((set) => set.reps !== null || set.seconds !== null, {
    message: "A set has reps or a time",
    path: ["reps"],
  });
export type StrengthSet = z.infer<typeof strengthSetSchema>;

export const loggedExerciseSchema = z.object({
  exerciseId: exerciseIdSchema,
  group: z
    .number()
    .int()
    .min(1)
    .max(MAX_EXERCISES_PER_SESSION)
    .nullable()
    .describe(
      "Exercises next to each other with the same group are done together, a set of each in turn: two make a superset, more a circuit",
    ),
  notes: z.string().trim().max(1000).nullable(),
  sets: z.array(strengthSetSchema).min(1).max(MAX_SETS_PER_EXERCISE),
});
export type LoggedExercise = z.infer<typeof loggedExerciseSchema>;

export const strengthDetailSchema = z
  .object({
    sport: z.literal("strength"),
    exercises: z.array(loggedExerciseSchema).max(MAX_EXERCISES_PER_SESSION),
  })
  .refine(({ exercises }) => groupsAreAdjacent(exercises), {
    message: "The exercises of a group stand next to each other",
    path: ["exercises"],
  });
export type StrengthDetail = z.infer<typeof strengthDetailSchema>;

function groupsAreAdjacent(exercises: readonly { group: number | null }[]) {
  const closed = new Set<number>();
  let open: number | null = null;
  for (const { group } of exercises) {
    if (group !== open && open !== null) closed.add(open);
    if (group !== null && closed.has(group)) return false;
    open = group;
  }
  return true;
}
