import { z } from "zod";

import { circuitSchema, gradeSchema } from "./grades.ts";

export const MAX_PROBLEMS_PER_SESSION = 200;

export const problemOutcomeSchema = z
  .enum(["flash", "send", "repeat", "project"])
  .describe(
    "flash: topped on the first attempt, never tried before. send: topped for the first time after more attempts, in this session or earlier ones. repeat: topped again, having sent it before. project: tried, not topped",
  );
export type ProblemOutcome = z.infer<typeof problemOutcomeSchema>;

export const problemStyles = [
  "crimpy",
  "slopey",
  "pinchy",
  "pockets",
  "jugs",
  "dynamic",
  "powerful",
  "technical",
  "compression",
  "mantle",
] as const;
export const problemStyleSchema = z.enum(problemStyles);
export type ProblemStyle = z.infer<typeof problemStyleSchema>;

export const wallAngleSchema = z.enum(["slab", "vertical", "overhang", "roof"]);
export type WallAngle = z.infer<typeof wallAngleSchema>;

export const problemSchema = z
  .object({
    grade: gradeSchema,
    name: z.string().trim().min(1).max(120).nullable(),
    attempts: z
      .number()
      .int()
      .min(1)
      .max(999)
      .describe("Attempts in this session, the topping one included"),
    outcome: problemOutcomeSchema,
    styles: z.array(problemStyleSchema).max(problemStyles.length),
    angle: wallAngleSchema.nullable(),
    notes: z.string().trim().max(1000).nullable(),
    restSeconds: z.number().int().min(0).max(3600).nullable().describe("The rest after it"),
  })
  .refine(({ outcome, attempts }) => outcome !== "flash" || attempts === 1, {
    message: "A flash takes one attempt",
    path: ["attempts"],
  });
export type Problem = z.infer<typeof problemSchema>;

export const venueSchema = z.object({
  kind: z.enum(["gym", "crag"]),
  name: z.string().trim().min(1).max(120).nullable(),
});
export type Venue = z.infer<typeof venueSchema>;

export const boulderingDetailSchema = z
  .object({
    sport: z.literal("bouldering"),
    venue: venueSchema,
    circuit: circuitSchema
      .nullable()
      .describe("The gym's colour circuit, which problems graded by colour belong to"),
    problems: z.array(problemSchema).max(MAX_PROBLEMS_PER_SESSION),
  })
  .refine(
    ({ circuit, problems }) =>
      problems.every(
        ({ grade }) =>
          grade.scale !== "circuit" ||
          (circuit?.colours.some(({ name }) => name === grade.colour) ?? false),
      ),
    {
      message: "A problem graded by colour uses a colour of the session's circuit",
      path: ["problems"],
    },
  );
export type BoulderingDetail = z.infer<typeof boulderingDetailSchema>;
