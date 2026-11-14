export interface AnalysisRecord {
  readonly elapsedSeconds: number;
  readonly power?: number | undefined;
  readonly heartRate?: number | undefined;
  readonly speedMetresPerSecond?: number | undefined;
  readonly distanceMetres?: number | undefined;
  readonly altitudeMetres?: number | undefined;
}

import {
  type HeldSegments,
  heldSegments,
  overlapsPause,
  pausedRecords,
  type SamplingRule,
  samplingRule,
  type Span,
} from "./sampling.ts";

export type { Span } from "./sampling.ts";

export const maxActivitySeconds = 7 * 24 * 60 * 60;

export const plausibleRanges = {
  power: { min: 0, max: 3000 },
  heartRate: { min: 25, max: 250 },
  speed: { min: 0, max: 50 },
  runningSpeed: { min: 0, max: 12.5 },
  distance: { min: 0, max: 10_000_000 },
  altitude: { min: -500, max: 9000 },
} as const;

export interface Samples {
  readonly count: number;
  readonly elapsed: Float64Array;
  readonly power: Float64Array;
  readonly heartRate: Float64Array;
  readonly speed: Float64Array;
  readonly distance: Float64Array;
  readonly altitude: Float64Array;
  readonly held: HeldSegments;
  readonly paused: Uint8Array;
}

export interface SamplesOptions {
  readonly pauses?: readonly Span[];
  readonly rule?: SamplingRule;
}

type Range = { readonly min: number; readonly max: number };

const isColumns = (
  records: readonly AnalysisRecord[] | AnalysisColumns,
): records is AnalysisColumns => !Array.isArray(records);

const within = (value: number | undefined, { min, max }: Range) =>
  value !== undefined && Number.isFinite(value) && value >= min && value <= max ? value : NaN;

export interface AnalysisColumns {
  readonly count: number;
  readonly elapsedSeconds: Float64Array;
  readonly power: Float64Array;
  readonly heartRate: Float64Array;
  readonly speedMetresPerSecond: Float64Array;
  readonly distanceMetres: Float64Array;
  readonly altitudeMetres: Float64Array;
}

export const analysisColumnLimits = {
  untilSeconds: maxActivitySeconds,
  maxRecords: maxActivitySeconds + 1,
} as const;

export function columnsOf(records: readonly AnalysisRecord[]): AnalysisColumns {
  const column = (value: (record: AnalysisRecord) => number | undefined) =>
    Float64Array.from(records, (record) => value(record) ?? NaN);
  return {
    count: records.length,
    elapsedSeconds: column((record) => record.elapsedSeconds),
    power: column((record) => record.power),
    heartRate: column((record) => record.heartRate),
    speedMetresPerSecond: column((record) => record.speedMetresPerSecond),
    distanceMetres: column((record) => record.distanceMetres),
    altitudeMetres: column((record) => record.altitudeMetres),
  };
}

const isKept = (seconds: number) => Number.isFinite(seconds) && seconds <= maxActivitySeconds;

function inTimeOrder(columns: AnalysisColumns): AnalysisColumns {
  const { count, elapsedSeconds: elapsed } = columns;
  let kept = 0;
  let ordered = true;
  let previous = -Infinity;
  for (let index = 0; index < count; index++) {
    const seconds = elapsed[index]!;
    if (!isKept(seconds)) continue;
    kept++;
    if (seconds < previous) ordered = false;
    previous = seconds;
  }
  if (kept === count && ordered) return columns;
  const order = new Uint32Array(kept);
  for (let index = 0, next = 0; index < count; index++) {
    if (isKept(elapsed[index]!)) order[next++] = index;
  }
  if (!ordered) order.sort((a, b) => elapsed[a]! - elapsed[b]! || a - b);
  const gathered = (values: Float64Array) => Float64Array.from(order, (index) => values[index]!);
  return {
    count: kept,
    elapsedSeconds: gathered(elapsed),
    power: gathered(columns.power),
    heartRate: gathered(columns.heartRate),
    speedMetresPerSecond: gathered(columns.speedMetresPerSecond),
    distanceMetres: gathered(columns.distanceMetres),
    altitudeMetres: gathered(columns.altitudeMetres),
  };
}

export function samplesOf(
  records: readonly AnalysisRecord[] | AnalysisColumns,
  sport: string | null,
  { pauses = [], rule = samplingRule }: SamplesOptions = {},
): Samples {
  const raw = inTimeOrder(isColumns(records) ? records : columnsOf(records));
  const { count, elapsedSeconds: elapsed } = raw;
  const speedRange = sport === "running" ? plausibleRanges.runningSpeed : plausibleRanges.speed;
  const paused = pausedRecords(elapsed, pauses);
  const samples: Samples = {
    count,
    elapsed,
    power: raw.power,
    heartRate: raw.heartRate,
    speed: raw.speedMetresPerSecond,
    distance: raw.distanceMetres,
    altitude: raw.altitudeMetres,
    held: heldSegments(elapsed, pauses, rule),
    paused,
  };
  let furthest = NaN;
  let previousWithDistance = -1;
  for (let index = 0; index < count; index++) {
    const seconds = elapsed[index]!;
    if (paused[index]) {
      for (const values of [
        samples.power,
        samples.heartRate,
        samples.speed,
        samples.distance,
        samples.altitude,
      ]) {
        values[index] = NaN;
      }
      continue;
    }
    samples.power[index] = within(samples.power[index], plausibleRanges.power);
    samples.heartRate[index] = within(samples.heartRate[index], plausibleRanges.heartRate);
    samples.altitude[index] = within(samples.altitude[index], plausibleRanges.altitude);
    const distance = within(samples.distance[index], plausibleRanges.distance);
    if (!Number.isNaN(distance))
      furthest = Number.isNaN(furthest) ? distance : Math.max(furthest, distance);
    samples.distance[index] = Number.isNaN(distance) ? NaN : furthest;
    const rawSpeed = samples.speed[index]!;
    let speed = within(rawSpeed, speedRange);
    if (Number.isNaN(rawSpeed) && previousWithDistance >= 0 && !Number.isNaN(distance)) {
      const previous = elapsed[previousWithDistance]!;
      const gap = seconds - previous;
      if (gap > 0 && gap <= rule.maxHeldGapSeconds && !overlapsPause(pauses, previous, seconds)) {
        speed = within(
          (samples.distance[index]! - samples.distance[previousWithDistance]!) / gap,
          speedRange,
        );
      }
    }
    samples.speed[index] = speed;
    if (!Number.isNaN(distance)) previousWithDistance = index;
  }
  return samples;
}

export const hasValue = (values: Float64Array) => values.some((value) => !Number.isNaN(value));

export const wholeActivity: Span = { from: -Infinity, to: Infinity };

function firstEndingAfter(end: Float64Array, seconds: number): number {
  let low = 0;
  let high = end.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (end[middle]! <= seconds) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function forEachHeldInterval(
  samples: Samples,
  visit: (index: number, seconds: number) => void,
  span: Span = wholeActivity,
): void {
  const { held } = samples;
  for (let segment = firstEndingAfter(held.end, span.from); segment < held.count; segment++) {
    const start = held.start[segment]!;
    if (start >= span.to) break;
    const seconds = Math.min(held.end[segment]!, span.to) - Math.max(start, span.from);
    if (seconds > 0) visit(held.record[segment]!, seconds);
  }
}

export function perSecond(samples: Samples, values: Float64Array): Float64Array {
  if (samples.count === 0 || !hasValue(values)) return new Float64Array(0);
  const length = Math.max(Math.trunc(samples.elapsed[samples.count - 1]!) + 1, 0);
  const result = new Float64Array(length);
  const { held } = samples;
  const fill = (index: number, from: number, to: number) => {
    const first = Math.trunc(from);
    if (first < 0 || first >= length) return;
    const value = values[index]!;
    result.fill(
      Number.isNaN(value) ? 0 : value,
      first,
      Math.min(Math.max(Math.trunc(to), first + 1), length),
    );
  };
  let segment = 0;
  for (let index = 0; index < samples.count; index++) {
    if (segment < held.count && held.record[segment] === index) {
      for (; segment < held.count && held.record[segment] === index; segment++) {
        fill(index, held.start[segment]!, held.end[segment]!);
      }
    } else if (!samples.paused[index]) {
      const elapsed = samples.elapsed[index]!;
      fill(index, elapsed, elapsed);
    }
  }
  return result;
}

export function prefixSums(values: Float64Array): Float64Array {
  const sums = new Float64Array(values.length + 1);
  for (let index = 0; index < values.length; index++)
    sums[index + 1] = sums[index]! + values[index]!;
  return sums;
}

export function averageWhileHeld(
  samples: Samples,
  values: Float64Array,
  span: Span = wholeActivity,
): number | null {
  let total = 0;
  let seconds = 0;
  forEachHeldInterval(
    samples,
    (index, duration) => {
      const value = values[index]!;
      if (Number.isNaN(value)) return;
      total += value * duration;
      seconds += duration;
    },
    span,
  );
  return seconds > 0 ? total / seconds : null;
}

export const rounded = (value: number) => Math.sign(value) * Math.round(Math.abs(value));
