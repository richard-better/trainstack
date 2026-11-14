import type { Block, Level, Step, Workout } from "@trainstack/workout";

import { type AnalysisActivity, lapSpans, zoneSport } from "./activity.ts";
import { plannedLength } from "./durations.ts";
import type { PlanThresholds } from "./planned.ts";
import { samplesOf, type Samples } from "./samples.ts";
import { timerPauses } from "./sampling.ts";

export type IntervalMetric = "power" | "speed" | "heart_rate";

export interface IntervalStep {
  readonly index: number;
  readonly name: string | null;
  readonly placed: boolean;
  readonly metric: IntervalMetric;
  readonly seconds: number;
  readonly secondsWithData: number;
  readonly secondsInTarget: number;
  readonly low: number;
  readonly high: number;
  readonly average: number | null;
}

export interface IntervalCompliance {
  readonly alignedBy: "laps" | "time";
  readonly secondsWithData: number;
  readonly secondsInTarget: number;
  readonly stepCount: number;
  readonly steps: readonly IntervalStep[];
}

export const constantTolerance = 0.05;
export const rangeTolerance = 0.025;
export const smoothingSeconds: Readonly<Record<IntervalMetric, number>> = {
  power: 3,
  speed: 10,
  heart_rate: 1,
};
export const maxReportedSteps = 200;
export const lapToleranceShare = 0.1;
export const lapToleranceSeconds = 5;

type Band = { metric: IntervalMetric; at: (fraction: number) => [number, number] };

const scaled = (reference: number | undefined, share: boolean) =>
  share ? (reference !== undefined && reference > 0 ? reference : undefined) : 1;

function band(level: Level, scale: number): Band["at"] {
  switch (level.kind) {
    case "constant":
      return () => [
        level.value * scale * (1 - constantTolerance),
        level.value * scale * (1 + constantTolerance),
      ];
    case "range":
      return () => [
        level.low * scale * (1 - rangeTolerance),
        level.high * scale * (1 + rangeTolerance),
      ];
    case "ramp":
      return (fraction) => {
        const value = (level.from + (level.to - level.from) * fraction) * scale;
        return [value * (1 - constantTolerance), value * (1 + constantTolerance)];
      };
  }
}

export function stepBand(step: Step, thresholds: PlanThresholds): Band | undefined {
  const target = step.target;
  if (!target) return undefined;
  switch (target.type) {
    case "maxEffort":
      return undefined;
    case "power": {
      const scale = scaled(thresholds.ftp, target.unit === "ftp");
      return scale === undefined ? undefined : { metric: "power", at: band(target.level, scale) };
    }
    case "pace": {
      const scale = scaled(thresholds.thresholdSpeed, target.unit === "threshold");
      return scale === undefined ? undefined : { metric: "speed", at: band(target.level, scale) };
    }
    case "heartRate": {
      const scale = scaled(thresholds.lactateThresholdHeartRate, target.unit === "threshold");
      return scale === undefined
        ? undefined
        : { metric: "heart_rate", at: band(target.level, scale) };
    }
  }
}

function expanded(blocks: readonly Block[]): Step[] {
  return blocks.flatMap((block) =>
    block.type === "step"
      ? [block]
      : Array.from({ length: block.count }, () => expanded(block.steps)).flat(),
  );
}

function perSecondOrNaN(samples: Samples, values: Float64Array, length: number) {
  const result = new Float64Array(length).fill(NaN);
  const { held } = samples;
  for (let segment = 0; segment < held.count; segment++) {
    const value = values[held.record[segment]!]!;
    if (Number.isNaN(value)) continue;
    const first = Math.max(0, Math.trunc(held.start[segment]!));
    const last = Math.min(length, Math.max(Math.trunc(held.end[segment]!), first + 1));
    result.fill(value, first, last);
  }
  return result;
}

type Placed = { from: number; to: number; seconds: number[]; progress?: number[] };

function movingSeconds(span: { from: number; to: number }, moving: Uint8Array) {
  const seconds: number[] = [];
  for (let second = Math.floor(span.from); second < Math.min(span.to, moving.length); second++) {
    if (second >= 0 && moving[second]) seconds.push(second);
  }
  return seconds;
}

function visitProgress(step: Step, count: number): number[] | undefined {
  const length = plannedLength(step);
  if (length?.kind !== "time") return undefined;
  return Array.from({ length: count }, (_, position) =>
    length.seconds > 1 ? Math.min(1, position / (length.seconds - 1)) : 0,
  );
}

function placedByStepLaps(
  activity: AnalysisActivity,
  steps: readonly Step[],
  moving: Uint8Array,
): (Placed | null)[] | undefined {
  const placedLaps = (activity.laps ?? []).filter(
    (lap) => lap.startTime !== undefined && Number.isFinite(lap.startTime.getTime()),
  );
  if (!placedLaps.some((lap) => lap.workoutStepIndex !== undefined)) return undefined;
  const spans = lapSpans(activity);
  const placed: (Placed | null)[] = steps.map(() => null);
  const visited: number[] = [];
  for (const [index, span] of spans.entries()) {
    const step = placedLaps[index]?.workoutStepIndex;
    if (step === undefined) continue;
    if (!Number.isInteger(step) || step < 0 || step >= steps.length) return undefined;
    const earlier = placed[step] ?? null;
    const last = earlier?.seconds.at(-1) ?? -1;
    const seconds = movingSeconds(span, moving).filter((second) => second > last);
    const continuesTheVisit = placedLaps[index - 1]?.workoutStepIndex === step;
    const ridden = (continuesTheVisit ? (visited[step] ?? 0) : 0) + seconds.length;
    visited[step] = ridden;
    const progress = visitProgress(steps[step]!, ridden)?.slice(ridden - seconds.length);
    placed[step] = {
      from: earlier?.from ?? span.from,
      to: span.to,
      seconds: [...(earlier?.seconds ?? []), ...seconds],
      progress:
        progress && (earlier === null || earlier.progress !== undefined)
          ? [...(earlier?.progress ?? []), ...progress]
          : undefined,
    };
  }
  return placed;
}

function placedByLaps(
  activity: AnalysisActivity,
  workout: Workout,
  steps: readonly Step[],
  moving: Uint8Array,
) {
  const lapsNameExpandedSteps = workout.steps.every((block) => block.type !== "repeat");
  const byStep = lapsNameExpandedSteps ? placedByStepLaps(activity, steps, moving) : undefined;
  if (byStep) return byStep;
  const spans = lapSpans(activity);
  if (spans.length !== steps.length) return undefined;
  if (steps.length < 2 && plannedLength(steps[0]!) !== null) return undefined;
  const fitsThePlan = spans.every((span, index) => {
    const length = plannedLength(steps[index]!);
    if (length?.kind !== "time") return true;
    const tolerance = Math.max(lapToleranceSeconds, lapToleranceShare * length.seconds);
    return Math.abs(span.to - span.from - length.seconds) <= tolerance;
  });
  if (!fitsThePlan) return undefined;
  return spans.map((span): Placed => ({
    from: span.from,
    to: span.to,
    seconds: movingSeconds(span, moving),
  }));
}

function placedByTime(steps: readonly Step[], moving: Uint8Array, distance: Float64Array) {
  const placed: (Placed | null)[] = [];
  let second = 0;
  let known = true;
  let boundary = NaN;
  for (const step of steps) {
    const length = known ? plannedLength(step) : null;
    if (length === null) {
      known = false;
      placed.push(null);
      continue;
    }
    const seconds: number[] = [];
    const progress: number[] = [];
    const from = second;
    if (length.kind === "time") {
      while (second < moving.length && seconds.length < length.seconds) {
        if (moving[second]) {
          progress.push(
            length.seconds > 1 ? Math.min(1, seconds.length / (length.seconds - 1)) : 0,
          );
          seconds.push(second);
        }
        second++;
      }
      boundary = NaN;
    } else {
      if (!distance.subarray(second).some((covered) => !Number.isNaN(covered))) {
        known = false;
        placed.push(null);
        continue;
      }
      let start = boundary;
      let lastCovered = 0;
      let reached = false;
      while (second < moving.length) {
        if (moving[second]) {
          const covered = distance[second]!;
          if (Number.isNaN(start) && !Number.isNaN(covered)) start = covered;
          if (!Number.isNaN(covered)) lastCovered = covered - start;
          if (!Number.isNaN(covered) && covered - start >= length.meters) {
            reached = true;
            break;
          }
          progress.push(Math.min(1, Math.max(0, lastCovered / length.meters)));
          seconds.push(second);
        }
        second++;
      }
      boundary = reached ? start + length.meters : NaN;
      if (seconds.length === 0) {
        placed.push(null);
        continue;
      }
    }
    placed.push({ from, to: second, seconds, progress });
  }
  return placed;
}

export function intervalCompliance(
  activity: AnalysisActivity,
  workout: Workout,
  thresholds: PlanThresholds,
): IntervalCompliance | null {
  const steps = expanded(workout.steps);
  const bands = steps.map((step) => stepBand(step, thresholds));
  if (bands.every((entry) => entry === undefined)) return null;
  const sport = zoneSport(activity.summary.sport, activity.summary.subSport);
  const pauses = timerPauses(activity.events ?? [], activity.summary.startTime);
  const samples = samplesOf(activity.records, sport, { pauses });
  if (samples.count === 0) return null;
  const length = Math.max(Math.trunc(samples.elapsed[samples.count - 1]!) + 1, 0);
  const timerRunning = new Uint8Array(length).fill(1);
  for (const { from, to } of pauses) {
    const first = Math.max(0, Math.ceil(from));
    const last = Math.min(length, Number.isFinite(to) ? Math.floor(to) : length);
    if (last > first) timerRunning.fill(0, first, last);
  }
  const series: Record<IntervalMetric, Float64Array> = {
    power: perSecondOrNaN(samples, samples.power, length),
    speed: perSecondOrNaN(samples, samples.speed, length),
    heart_rate: perSecondOrNaN(samples, samples.heartRate, length),
  };
  const byLaps = placedByLaps(activity, workout, steps, timerRunning);
  const placed =
    byLaps ?? placedByTime(steps, timerRunning, perSecondOrNaN(samples, samples.distance, length));
  let secondsWithData = 0;
  let secondsInTarget = 0;
  const reported: IntervalStep[] = [];
  steps.forEach((step, index) => {
    const stepBand = bands[index];
    if (!stepBand) return;
    const place = placed[index] ?? null;
    if (place === null) {
      if (reported.length < maxReportedSteps) {
        const [low, high] = stepBand.at(0.5);
        reported.push({
          index,
          name: step.name ?? null,
          placed: false,
          metric: stepBand.metric,
          seconds: 0,
          secondsWithData: 0,
          secondsInTarget: 0,
          low,
          high,
          average: null,
        });
      }
      return;
    }
    const raw = place.seconds.map((second) => series[stepBand.metric][second]!);
    const span = place.seconds.length;
    const bandAt = (position: number) =>
      stepBand.at(place.progress?.[position] ?? (span > 1 ? position / (span - 1) : 0));
    const window = smoothingSeconds[stepBand.metric];
    let withData = 0;
    let inTarget = 0;
    let sum = 0;
    raw.forEach((reading, position) => {
      if (Number.isNaN(reading)) return;
      let value = 0;
      let low = 0;
      let high = 0;
      let count = 0;
      for (let back = Math.max(0, position - window + 1); back <= position; back++) {
        const earlier = raw[back]!;
        if (Number.isNaN(earlier)) continue;
        const [bandLow, bandHigh] = bandAt(back);
        value += earlier;
        low += bandLow;
        high += bandHigh;
        count += 1;
      }
      value /= count;
      withData += 1;
      sum += reading;
      if (value >= low / count && value <= high / count) inTarget += 1;
    });
    secondsWithData += withData;
    secondsInTarget += inTarget;
    if (reported.length < maxReportedSteps) {
      const [low, high] = stepBand.at(0.5);
      reported.push({
        index,
        name: step.name ?? null,
        placed: true,
        metric: stepBand.metric,
        seconds: place.seconds.length,
        secondsWithData: withData,
        secondsInTarget: inTarget,
        low,
        high,
        average: withData > 0 ? sum / withData : null,
      });
    }
  });
  return {
    alignedBy: byLaps ? "laps" : "time",
    secondsWithData,
    secondsInTarget,
    stepCount: steps.length,
    steps: reported,
  };
}
