import type { BoulderingDetail, Problem, ProblemOutcome } from "./bouldering.ts";
import {
  asFont,
  asV,
  type Circuit,
  compareGrades,
  type FontGrade,
  fontGrades,
  type Grade,
  gradeLabel,
  type GradeScale,
  type VGrade,
  vGrades,
} from "./grades.ts";

export const isTop = (outcome: ProblemOutcome) => outcome !== "project";
export const isFirstAscent = (outcome: ProblemOutcome) => outcome === "flash" || outcome === "send";

export type GradedProblem = { grade: Grade; circuit: Circuit | null };

export type BoulderingSummary = {
  sport: "bouldering";
  problems: number;
  tops: number;
  sends: number;
  flashes: number;
  attempts: number;
  hardestTop: GradedProblem | null;
  hardestFlash: GradedProblem | null;
};

function hardest(problems: Problem[], circuit: Circuit | null): GradedProblem | null {
  let best: GradedProblem | null = null;
  for (const { grade } of problems) {
    const candidate = { grade, circuit };
    if (best === null || compareGrades(candidate, best) > 0) best = candidate;
  }
  return best;
}

export function boulderingSummary(detail: BoulderingDetail): BoulderingSummary {
  const { problems, circuit } = detail;
  const tops = problems.filter(({ outcome }) => isTop(outcome));
  const flashes = problems.filter(({ outcome }) => outcome === "flash");
  return {
    sport: "bouldering",
    problems: problems.length,
    tops: tops.length,
    sends: problems.filter(({ outcome }) => isFirstAscent(outcome)).length,
    flashes: flashes.length,
    attempts: problems.reduce((sum, { attempts }) => sum + attempts, 0),
    hardestTop: hardest(tops, circuit),
    hardestFlash: hardest(flashes, circuit),
  };
}

export type PyramidScale = Exclude<GradeScale, "circuit"> | { circuit: string };

export type PyramidStep = {
  grade: string;
  flashes: number;
  sends: number;
  projects: number;
  attempts: number;
};

export type GradePyramid = {
  steps: PyramidStep[];
  ungraded: number;
};

function bucketOf(grade: Grade, circuit: Circuit | null, scale: PyramidScale) {
  if (scale === "font") return asFont(grade, circuit);
  if (scale === "v") return asV(grade, circuit);
  if (grade.scale !== "circuit" || circuit?.name !== scale.circuit) return null;
  return gradeLabel(grade);
}

function rankIn(scale: PyramidScale, bucket: string, circuit: Circuit | null) {
  if (scale === "font") return fontGrades.indexOf(bucket as FontGrade);
  if (scale === "v") return vGrades.indexOf(bucket as VGrade);
  return circuit?.colours.findIndex(({ name }) => name === bucket) ?? -1;
}

export function gradePyramid(
  sessions: readonly Pick<BoulderingDetail, "problems" | "circuit">[],
  scale: PyramidScale,
): GradePyramid {
  const steps = new Map<string, PyramidStep>();
  let latestCircuit: Circuit | null = null;
  let ungraded = 0;
  for (const { problems, circuit } of sessions) {
    if (typeof scale !== "string" && circuit?.name === scale.circuit) latestCircuit = circuit;
    for (const { grade, outcome, attempts } of problems) {
      if (outcome === "repeat") continue;
      const bucket = bucketOf(grade, circuit, scale);
      if (bucket === null) {
        ungraded++;
        continue;
      }
      const step = steps.get(bucket) ?? {
        grade: bucket,
        flashes: 0,
        sends: 0,
        projects: 0,
        attempts: 0,
      };
      if (outcome === "flash") step.flashes++;
      else if (outcome === "send") step.sends++;
      else step.projects++;
      step.attempts += attempts;
      steps.set(bucket, step);
    }
  }
  return {
    steps: [...steps.values()].sort(
      (a, b) => rankIn(scale, b.grade, latestCircuit) - rankIn(scale, a.grade, latestCircuit),
    ),
    ungraded,
  };
}
