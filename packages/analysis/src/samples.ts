export interface AnalysisRecord {
  readonly elapsedSeconds: number;
  readonly power?: number | undefined;
  readonly heartRate?: number | undefined;
  readonly speedMetresPerSecond?: number | undefined;
  readonly distanceMetres?: number | undefined;
  readonly altitudeMetres?: number | undefined;
}

export const maxSampleGapSeconds = 5;
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
}

type Range = { readonly min: number; readonly max: number };

const within = (value: number | undefined, { min, max }: Range) =>
  value !== undefined && Number.isFinite(value) && value >= min && value <= max ? value : NaN;

function inTimeOrder(records: readonly AnalysisRecord[]): readonly AnalysisRecord[] {
  const kept = records.filter(
    ({ elapsedSeconds }) => Number.isFinite(elapsedSeconds) && elapsedSeconds <= maxActivitySeconds,
  );
  const ordered = kept.every(
    (record, index) => index === 0 || kept[index - 1]!.elapsedSeconds <= record.elapsedSeconds,
  );
  return ordered ? kept : kept.toSorted((a, b) => a.elapsedSeconds - b.elapsedSeconds);
}

export function samplesOf(records: readonly AnalysisRecord[], sport: string | null): Samples {
  const ordered = inTimeOrder(records);
  const count = ordered.length;
  const speedRange = sport === "running" ? plausibleRanges.runningSpeed : plausibleRanges.speed;
  const samples: Samples = {
    count,
    elapsed: new Float64Array(count),
    power: new Float64Array(count),
    heartRate: new Float64Array(count),
    speed: new Float64Array(count),
    distance: new Float64Array(count),
    altitude: new Float64Array(count),
  };
  let furthest = NaN;
  let previousWithDistance = -1;
  for (let index = 0; index < count; index++) {
    const record = ordered[index]!;
    const elapsed = record.elapsedSeconds;
    samples.elapsed[index] = elapsed;
    samples.power[index] = within(record.power, plausibleRanges.power);
    samples.heartRate[index] = within(record.heartRate, plausibleRanges.heartRate);
    samples.altitude[index] = within(record.altitudeMetres, plausibleRanges.altitude);
    const distance = within(record.distanceMetres, plausibleRanges.distance);
    if (!Number.isNaN(distance))
      furthest = Number.isNaN(furthest) ? distance : Math.max(furthest, distance);
    samples.distance[index] = Number.isNaN(distance) ? NaN : furthest;
    let speed = within(record.speedMetresPerSecond, speedRange);
    if (
      Number.isNaN(speed) &&
      record.speedMetresPerSecond === undefined &&
      previousWithDistance >= 0 &&
      !Number.isNaN(distance)
    ) {
      const seconds = elapsed - samples.elapsed[previousWithDistance]!;
      if (seconds > 0 && seconds <= maxSampleGapSeconds) {
        speed = within(
          (samples.distance[index]! - samples.distance[previousWithDistance]!) / seconds,
          speedRange,
        );
      }
    }
    samples.speed[index] = speed;
    if (!Number.isNaN(distance)) previousWithDistance = index;
  }
  return samples;
}

export function sliceSamples(samples: Samples, start: number, end: number): Samples {
  const origin = samples.elapsed[start] ?? 0;
  return {
    count: Math.max(0, end - start),
    elapsed: samples.elapsed.slice(start, end).map((elapsed) => elapsed - origin),
    power: samples.power.subarray(start, end),
    heartRate: samples.heartRate.subarray(start, end),
    speed: samples.speed.subarray(start, end),
    distance: samples.distance.subarray(start, end),
    altitude: samples.altitude.subarray(start, end),
  };
}

export const hasValue = (values: Float64Array) => values.some((value) => !Number.isNaN(value));

export function forEachHeldInterval(
  samples: Samples,
  visit: (index: number, seconds: number) => void,
): void {
  for (let index = 0; index + 1 < samples.count; index++) {
    const seconds = samples.elapsed[index + 1]! - samples.elapsed[index]!;
    if (seconds > 0 && seconds <= maxSampleGapSeconds) visit(index, seconds);
  }
}

export function perSecond(samples: Samples, values: Float64Array): Float64Array {
  if (samples.count === 0 || !hasValue(values)) return new Float64Array(0);
  const length = Math.max(Math.trunc(samples.elapsed[samples.count - 1]!) + 1, 0);
  const result = new Float64Array(length);
  for (let index = 0; index < samples.count; index++) {
    const elapsed = samples.elapsed[index]!;
    const first = Math.trunc(elapsed);
    if (first < 0 || first >= length) continue;
    let end = first + 1;
    if (index + 1 < samples.count) {
      const next = samples.elapsed[index + 1]!;
      if (next - elapsed <= maxSampleGapSeconds) end = Math.max(Math.trunc(next), end);
    }
    const value = values[index]!;
    result.fill(Number.isNaN(value) ? 0 : value, first, Math.min(end, length));
  }
  return result;
}

export function prefixSums(values: Float64Array): Float64Array {
  const sums = new Float64Array(values.length + 1);
  for (let index = 0; index < values.length; index++)
    sums[index + 1] = sums[index]! + values[index]!;
  return sums;
}

export function averageWhileHeld(samples: Samples, values: Float64Array): number | null {
  let total = 0;
  let seconds = 0;
  forEachHeldInterval(samples, (index, duration) => {
    const value = values[index]!;
    if (Number.isNaN(value)) return;
    total += value * duration;
    seconds += duration;
  });
  return seconds > 0 ? total / seconds : null;
}

export const rounded = (value: number) => Math.sign(value) * Math.round(Math.abs(value));
