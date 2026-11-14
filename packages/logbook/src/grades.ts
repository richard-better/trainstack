import { z } from "zod";

export const fontGrades = [
  "3",
  "4",
  "4+",
  "5",
  "5+",
  "6A",
  "6A+",
  "6B",
  "6B+",
  "6C",
  "6C+",
  "7A",
  "7A+",
  "7B",
  "7B+",
  "7C",
  "7C+",
  "8A",
  "8A+",
  "8B",
  "8B+",
  "8C",
  "8C+",
  "9A",
] as const;
export const fontGradeSchema = z.enum(fontGrades);
export type FontGrade = z.infer<typeof fontGradeSchema>;

export const vGrades = [
  "VB",
  "V0",
  "V1",
  "V2",
  "V3",
  "V4",
  "V5",
  "V6",
  "V7",
  "V8",
  "V9",
  "V10",
  "V11",
  "V12",
  "V13",
  "V14",
  "V15",
  "V16",
  "V17",
] as const;
export const vGradeSchema = z.enum(vGrades);
export type VGrade = z.infer<typeof vGradeSchema>;

export const vToFont: Readonly<Record<VGrade, readonly [FontGrade, FontGrade]>> = {
  VB: ["3", "3"],
  V0: ["4", "4+"],
  V1: ["5", "5"],
  V2: ["5+", "5+"],
  V3: ["6A", "6A+"],
  V4: ["6B", "6B+"],
  V5: ["6C", "6C+"],
  V6: ["7A", "7A"],
  V7: ["7A+", "7A+"],
  V8: ["7B", "7B+"],
  V9: ["7C", "7C"],
  V10: ["7C+", "7C+"],
  V11: ["8A", "8A"],
  V12: ["8A+", "8A+"],
  V13: ["8B", "8B"],
  V14: ["8B+", "8B+"],
  V15: ["8C", "8C"],
  V16: ["8C+", "8C+"],
  V17: ["9A", "9A"],
};

const fontIndex = (grade: FontGrade) => fontGrades.indexOf(grade);

export const fontToV = Object.fromEntries(
  fontGrades.map((font) => [
    font,
    vGrades.find((v) => {
      const [from, to] = vToFont[v];
      return fontIndex(from) <= fontIndex(font) && fontIndex(font) <= fontIndex(to);
    })!,
  ]),
) as Readonly<Record<FontGrade, VGrade>>;

export const circuitColourSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    from: fontGradeSchema.nullable(),
    to: fontGradeSchema.nullable(),
  })
  .refine(
    ({ from, to }) =>
      (from === null) === (to === null) &&
      (from === null || to === null || fontIndex(from) <= fontIndex(to)),
    { message: "A colour's Font range has both ends, the easier first", path: ["to"] },
  )
  .describe(
    "One colour of a gym's circuit, with the Font range the gym gives it, or none when the gym gives no grade",
  );
export type CircuitColour = z.infer<typeof circuitColourSchema>;

export const circuitSchema = z
  .object({
    name: z.string().trim().min(1).max(80).describe("Such as the gym's name"),
    colours: z.array(circuitColourSchema).min(1).max(20).describe("The easiest first"),
  })
  .refine(({ colours }) => new Set(colours.map(({ name }) => name)).size === colours.length, {
    message: "Each colour is named once",
    path: ["colours"],
  });
export type Circuit = z.infer<typeof circuitSchema>;

export const gradeSchema = z
  .discriminatedUnion("scale", [
    z.object({ scale: z.literal("font"), grade: fontGradeSchema }),
    z.object({ scale: z.literal("v"), grade: vGradeSchema }),
    z.object({ scale: z.literal("circuit"), colour: z.string().trim().min(1).max(40) }),
  ])
  .describe(
    "A grade as the athlete gave it: Fontainebleau, V (Hueco), or a colour of the session's circuit",
  );
export type Grade = z.infer<typeof gradeSchema>;

export type GradeScale = Grade["scale"];

export type Difficulty = {
  from: number;
  to: number;
};

export function difficultyOf(grade: Grade, circuit: Circuit | null): Difficulty | null {
  switch (grade.scale) {
    case "font": {
      const index = fontIndex(grade.grade);
      return { from: index, to: index };
    }
    case "v": {
      const [from, to] = vToFont[grade.grade];
      return { from: fontIndex(from), to: fontIndex(to) };
    }
    case "circuit": {
      const colour = circuit?.colours.find(({ name }) => name === grade.colour);
      if (!colour?.from || !colour.to) return null;
      return { from: fontIndex(colour.from), to: fontIndex(colour.to) };
    }
  }
}

export const colourRank = (grade: Grade, circuit: Circuit | null) =>
  grade.scale === "circuit"
    ? (circuit?.colours.findIndex(({ name }) => name === grade.colour) ?? -1)
    : -1;

export function asFont(grade: Grade, circuit: Circuit | null): FontGrade | null {
  const difficulty = difficultyOf(grade, circuit);
  return difficulty ? fontGrades[difficulty.from]! : null;
}

export function asV(grade: Grade, circuit: Circuit | null): VGrade | null {
  const font = asFont(grade, circuit);
  return font ? fontToV[font] : null;
}

export function gradeLabel(grade: Grade) {
  return grade.scale === "circuit" ? grade.colour : grade.grade;
}

export function compareGrades(
  a: { grade: Grade; circuit: Circuit | null },
  b: { grade: Grade; circuit: Circuit | null },
) {
  const sameCircuit =
    a.grade.scale === "circuit" &&
    b.grade.scale === "circuit" &&
    a.circuit !== null &&
    a.circuit.name === b.circuit?.name;
  if (sameCircuit) return colourRank(a.grade, a.circuit) - colourRank(b.grade, b.circuit);
  const da = difficultyOf(a.grade, a.circuit);
  const db = difficultyOf(b.grade, b.circuit);
  if (da && db) return da.from - db.from || da.to - db.to;
  if (da) return 1;
  if (db) return -1;
  return 0;
}
