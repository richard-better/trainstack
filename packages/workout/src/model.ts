import { z } from "zod";
import { expandedLength, maxExpandedSteps } from "./timeline";

export const sportSchema = z.enum(["cycling", "running", "swimming"]);
export type Sport = z.infer<typeof sportSchema>;

export const focusSchema = z.enum([
  "recovery",
  "endurance",
  "tempo",
  "threshold",
  "vo2Max",
  "anaerobic",
]);
export type Focus = z.infer<typeof focusSchema>;

const amount = z.number().finite().nonnegative();

export const constantLevelSchema = z.object({
  kind: z.literal("constant"),
  value: amount,
});

export const rangeLevelSchema = z
  .object({
    kind: z.literal("range"),
    low: amount,
    high: amount,
  })
  .refine((range) => range.low <= range.high, {
    message: "A range's low end must not exceed its high end",
    path: ["high"],
  });

export const rampLevelSchema = z.object({
  kind: z.literal("ramp"),
  from: amount,
  to: amount,
});

export const levelSchema = z.discriminatedUnion("kind", [
  constantLevelSchema,
  rangeLevelSchema,
  rampLevelSchema,
]);
export type Level = z.infer<typeof levelSchema>;

export const cadenceSchema = z.discriminatedUnion("kind", [constantLevelSchema, rangeLevelSchema]);
export type Cadence = z.infer<typeof cadenceSchema>;

export const powerTargetSchema = z.object({
  type: z.literal("power"),
  unit: z.enum(["ftp", "watts"]),
  level: levelSchema,
});

export const paceTargetSchema = z.object({
  type: z.literal("pace"),
  unit: z.enum(["threshold", "metersPerSecond"]),
  level: levelSchema,
});

export const heartRateTargetSchema = z.object({
  type: z.literal("heartRate"),
  unit: z.enum(["threshold", "bpm"]),
  level: levelSchema,
});

export const maxEffortTargetSchema = z.object({
  type: z.literal("maxEffort"),
});

export const targetSchema = z.discriminatedUnion("type", [
  powerTargetSchema,
  paceTargetSchema,
  heartRateTargetSchema,
  maxEffortTargetSchema,
]);
export type Target = z.infer<typeof targetSchema>;
export type PowerTarget = z.infer<typeof powerTargetSchema>;
export type PaceTarget = z.infer<typeof paceTargetSchema>;
export type HeartRateTarget = z.infer<typeof heartRateTargetSchema>;

const positive = z.number().finite().positive();

export const timeDurationSchema = z.object({ type: z.literal("time"), seconds: positive });
export const distanceDurationSchema = z.object({ type: z.literal("distance"), meters: positive });

export const durationSchema = z.discriminatedUnion("type", [
  timeDurationSchema,
  distanceDurationSchema,
]);
export type Duration = z.infer<typeof durationSchema>;

export const offsetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("time"), seconds: amount }),
  z.object({ type: z.literal("distance"), meters: amount }),
]);
export type Offset = z.infer<typeof offsetSchema>;

export const cueSchema = z.object({
  at: offsetSchema,
  text: z.string().min(1),
  shownForSeconds: positive.optional(),
});
export type Cue = z.infer<typeof cueSchema>;

export const intensitySchema = z.enum(["warmUp", "active", "recovery", "rest", "coolDown"]);
export type Intensity = z.infer<typeof intensitySchema>;

export const stepSchema = z.object({
  type: z.literal("step"),
  duration: durationSchema,
  target: targetSchema.optional(),
  cadence: cadenceSchema.optional(),
  intensity: intensitySchema.optional(),
  name: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
  cues: z.array(cueSchema).optional(),
});
export type Step = z.infer<typeof stepSchema>;

export type Repeat = {
  type: "repeat";
  count: number;
  steps: Block[];
  name?: string | undefined;
  cues?: Cue[] | undefined;
};

export type Block = Step | Repeat;

export const repeatSchema: z.ZodType<Repeat> = z.object({
  type: z.literal("repeat"),
  count: z.number().int().positive(),
  get steps() {
    return z.array(blockSchema).min(1);
  },
  name: z.string().min(1).optional(),
  cues: z.array(cueSchema).optional(),
});

export const blockSchema: z.ZodType<Block> = z.union([stepSchema, repeatSchema]);

export const workoutSchema = z.object({
  name: z.string().min(1),
  sport: sportSchema,
  description: z.string().min(1).optional(),
  author: z.string().min(1).optional(),
  focus: focusSchema.optional(),
  tags: z.array(z.string().min(1)).optional(),
  steps: z
    .array(blockSchema)
    .min(1)
    .refine((steps) => expandedLength(steps) <= maxExpandedSteps, {
      message: `A workout can expand to at most ${maxExpandedSteps} steps`,
    }),
});
export type Workout = z.infer<typeof workoutSchema>;
