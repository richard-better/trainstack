import type { Block, Intensity, Level, Step, Target, Workout } from "@trainstack/workout";

import { normalizedAverage, normalizedPowerWindowSeconds, stressScore } from "./power.ts";

export interface PlanThresholds {
  readonly ftp?: number | undefined;
  readonly thresholdSpeed?: number | undefined;
  readonly lactateThresholdHeartRate?: number | undefined;
}

export interface PlannedEstimate {
  readonly seconds: number | null;
  readonly meters: number | null;
  readonly load: number | null;
  readonly includesExpected: boolean;
}

export const unguidedShares: Readonly<Record<Intensity | "unset", number>> = {
  warmUp: 0.55,
  active: 0.75,
  recovery: 0.5,
  rest: 0,
  coolDown: 0.5,
  unset: 0.65,
};

export const maxEffortShare = 1.5;
export const longestPlannedSeconds = 2 * 24 * 60 * 60;

type Shape = (fraction: number) => number;

const levelShape = (level: Level, scale: number): Shape => {
  switch (level.kind) {
    case "constant":
      return () => level.value * scale;
    case "range":
      return () => ((level.low + level.high) / 2) * scale;
    case "ramp":
      return (fraction) => (level.from + (level.to - level.from) * fraction) * scale;
  }
};

const shareOf = (reference: number | undefined) =>
  reference !== undefined && reference > 0 ? 1 / reference : undefined;

function targetShape(target: Target, thresholds: PlanThresholds): Shape | undefined {
  switch (target.type) {
    case "maxEffort":
      return () => maxEffortShare;
    case "power": {
      const scale = target.unit === "ftp" ? 1 : shareOf(thresholds.ftp);
      return scale === undefined ? undefined : levelShape(target.level, scale);
    }
    case "pace": {
      const scale = target.unit === "threshold" ? 1 : shareOf(thresholds.thresholdSpeed);
      return scale === undefined ? undefined : levelShape(target.level, scale);
    }
    case "heartRate": {
      const scale = target.unit === "threshold" ? 1 : shareOf(thresholds.lactateThresholdHeartRate);
      return scale === undefined ? undefined : levelShape(target.level, scale);
    }
  }
}

export function stepShape(step: Step, thresholds: PlanThresholds): Shape | undefined {
  if (step.target) return targetShape(step.target, thresholds);
  const share = unguidedShares[step.intensity ?? "unset"];
  return () => share;
}

function averageShare(shape: Shape) {
  return (shape(0) + 4 * shape(0.5) + shape(1)) / 6;
}

function expanded(blocks: readonly Block[]): Step[] {
  return blocks.flatMap((block) =>
    block.type === "step"
      ? [block]
      : Array.from({ length: block.count }, () => expanded(block.steps)).flat(),
  );
}

type Timed = { seconds: number; meters: number | null; shape: Shape | undefined };

function stepSpeed(step: Step, shape: Shape | undefined, thresholds: PlanThresholds) {
  const target = step.target;
  if (target?.type === "pace" && target.unit === "metersPerSecond") {
    return averageShare(levelShape(target.level, 1));
  }
  const reference = thresholds.thresholdSpeed;
  if (shape === undefined || reference === undefined || !(reference > 0)) return undefined;
  return averageShare(shape) * reference;
}

function timed(step: Step, thresholds: PlanThresholds): Timed | null {
  const length = step.duration.type === "open" ? step.duration.expected : step.duration;
  if (length === undefined) return null;
  const shape = stepShape(step, thresholds);
  const speed = stepSpeed(step, shape, thresholds);
  if (length.type === "time") {
    return {
      seconds: length.seconds,
      meters: speed === undefined ? null : speed * length.seconds,
      shape,
    };
  }
  if (speed === undefined || !(speed > 0)) return null;
  return { seconds: length.meters / speed, meters: length.meters, shape };
}

function perSecondShares(steps: readonly Timed[], totalSeconds: number) {
  const shares = new Float64Array(Math.ceil(totalSeconds));
  let start = 0;
  let index = 0;
  for (let second = 0; second < shares.length; second++) {
    const middle = second + 0.5;
    while (index < steps.length - 1 && middle >= start + steps[index]!.seconds) {
      start += steps[index]!.seconds;
      index += 1;
    }
    const step = steps[index]!;
    const fraction = step.seconds > 0 ? Math.min(1, (middle - start) / step.seconds) : 0;
    shares[second] = step.shape!(fraction);
  }
  return shares;
}

function intensityFactor(shares: Float64Array) {
  if (shares.length >= normalizedPowerWindowSeconds) return normalizedAverage(shares);
  if (shares.length === 0) return null;
  const fourth = shares.reduce((sum, share) => sum + share ** 4, 0) / shares.length;
  return fourth ** 0.25;
}

export function plannedEstimate(workout: Workout, thresholds: PlanThresholds): PlannedEstimate {
  const steps = expanded(workout.steps);
  const isDistanceBased = steps.some(
    (step) =>
      step.duration.type === "distance" ||
      (step.duration.type === "open" && step.duration.expected?.type === "distance"),
  );
  const timedSteps = steps.map((step) => timed(step, thresholds));
  if (timedSteps.some((step) => step === null)) {
    return { seconds: null, meters: null, load: null, includesExpected: false };
  }
  const includesExpected = steps.some((step) => step.duration.type === "open");
  const known = timedSteps as Timed[];
  const seconds = known.reduce((sum, step) => sum + step.seconds, 0);
  const meters =
    isDistanceBased && known.every((step) => step.meters !== null)
      ? known.reduce((sum, step) => sum + step.meters!, 0)
      : null;
  const canLoad =
    seconds > 0 &&
    seconds <= longestPlannedSeconds &&
    known.every((step) => step.shape !== undefined);
  const load = canLoad
    ? stressScore(seconds, intensityFactor(perSecondShares(known, seconds)))
    : null;
  return { seconds, meters, load, includesExpected };
}
