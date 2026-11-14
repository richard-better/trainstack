import type { Block, Level, Step, Workout } from "@trainstack/workout";

import { type AnalysisActivity, lapSpans, zoneSport } from "./activity.ts";
import type { PlanThresholds } from "./planned.ts";
import { samplesOf, type Samples } from "./samples.ts";
import { timerPauses } from "./sampling.ts";

export type IntervalMetric = "power" | "speed" | "heart_rate";

export interface IntervalStep {
  readonly index: number;
  readonly name: string | null;
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

function trailingAverage(values: Float64Array, window: number) {
  if (window <= 1) return values;
  const result = new Float64Array(values.length);
  let sum = 0;
  let count = 0;
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!;
    if (!Number.isNaN(value)) {
      sum += value;
      count += 1;
    }
    const leaving = index - window;
    if (leaving >= 0 && !Number.isNaN(values[leaving]!)) {
      sum -= values[leaving]!;
      count -= 1;
    }
    result[index] = Number.isNaN(value) || count === 0 ? NaN : sum / count;
  }
  return result;
}

type Placed = { from: number; to: number; seconds: number[] };

function placedByLaps(activity: AnalysisActivity, steps: readonly Step[], moving: Uint8Array) {
  const spans = lapSpans(activity);
  if (steps.length < 2 || spans.length !== steps.length) return undefined;
  return spans.map((span): Placed => {
    const seconds: number[] = [];
    for (let second = Math.floor(span.from); second < Math.min(span.to, moving.length); second++) {
      if (second >= 0 && moving[second]) seconds.push(second);
    }
    return { from: span.from, to: span.to, seconds };
  });
}

function placedByTime(steps: readonly Step[], moving: Uint8Array, distance: Float64Array) {
  const placed: Placed[] = [];
  let second = 0;
  for (const step of steps) {
    const seconds: number[] = [];
    const from = second;
    if (step.duration.type === "time") {
      while (second < moving.length && seconds.length < step.duration.seconds) {
        if (moving[second]) seconds.push(second);
        second++;
      }
    } else {
      let start = NaN;
      while (second < moving.length) {
        if (moving[second]) {
          const covered = distance[second]!;
          if (Number.isNaN(start) && !Number.isNaN(covered)) start = covered;
          if (!Number.isNaN(covered) && covered - start >= step.duration.meters) break;
          seconds.push(second);
        }
        second++;
      }
    }
    placed.push({ from, to: second, seconds });
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
  const moving = new Uint8Array(length);
  for (let segment = 0; segment < samples.held.count; segment++) {
    const first = Math.max(0, Math.trunc(samples.held.start[segment]!));
    const last = Math.min(length, Math.max(Math.trunc(samples.held.end[segment]!), first + 1));
    moving.fill(1, first, last);
  }
  const series: Record<IntervalMetric, Float64Array> = {
    power: trailingAverage(perSecondOrNaN(samples, samples.power, length), smoothingSeconds.power),
    speed: trailingAverage(perSecondOrNaN(samples, samples.speed, length), smoothingSeconds.speed),
    heart_rate: perSecondOrNaN(samples, samples.heartRate, length),
  };
  const byLaps = placedByLaps(activity, steps, moving);
  const placed =
    byLaps ?? placedByTime(steps, moving, perSecondOrNaN(samples, samples.distance, length));
  let secondsWithData = 0;
  let secondsInTarget = 0;
  const reported: IntervalStep[] = [];
  steps.forEach((step, index) => {
    const stepBand = bands[index];
    const place = placed[index];
    if (!stepBand || !place) return;
    const values = series[stepBand.metric];
    let withData = 0;
    let inTarget = 0;
    let sum = 0;
    place.seconds.forEach((second, position) => {
      const value = values[second]!;
      if (Number.isNaN(value)) return;
      const span =
        !byLaps && step.duration.type === "time" ? step.duration.seconds : place.seconds.length;
      const [low, high] = stepBand.at(span > 1 ? Math.min(1, position / (span - 1)) : 0);
      withData += 1;
      sum += value;
      if (value >= low && value <= high) inTarget += 1;
    });
    secondsWithData += withData;
    secondsInTarget += inTarget;
    if (reported.length < maxReportedSteps) {
      const [low, high] = stepBand.at(0.5);
      reported.push({
        index,
        name: step.name ?? null,
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
