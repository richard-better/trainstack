import {
  forEachHeldInterval,
  hasValue,
  prefixSums,
  rounded,
  type Samples,
  type Span,
  wholeActivity,
} from "./samples.ts";

export const powerCurveDurations = [5, 15, 30, 60, 300, 600, 1200, 1800, 3600] as const;
export const normalizedPowerWindowSeconds = 30;

export interface PowerCurvePoint {
  readonly durationSeconds: number;
  readonly watts: number;
}

export function powerCurve(
  powerPerSecond: Float64Array,
  durations: readonly number[] = powerCurveDurations,
): PowerCurvePoint[] {
  if (powerPerSecond.length === 0) return [];
  const sums = prefixSums(powerPerSecond);
  const points: PowerCurvePoint[] = [];
  for (const duration of durations) {
    const window = Math.trunc(duration);
    if (window <= 0 || window > powerPerSecond.length) continue;
    let best = -Infinity;
    for (let end = window; end <= powerPerSecond.length; end++) {
      best = Math.max(best, sums[end]! - sums[end - window]!);
    }
    points.push({ durationSeconds: duration, watts: rounded(best / window) });
  }
  return points;
}

export function normalizedAverage(
  perSecond: Float64Array,
  window = normalizedPowerWindowSeconds,
): number | null {
  if (perSecond.length < window) return null;
  const sums = prefixSums(perSecond);
  let sumOfFourthPowers = 0;
  for (let end = window; end <= perSecond.length; end++) {
    sumOfFourthPowers += ((sums[end]! - sums[end - window]!) / window) ** 4;
  }
  return (sumOfFourthPowers / (perSecond.length - window + 1)) ** 0.25;
}

export function normalizedPower(powerPerSecond: Float64Array): number | null {
  const normalized = normalizedAverage(powerPerSecond);
  return normalized === null ? null : rounded(normalized);
}

export function intensity(normalized: number | null, threshold: number | undefined): number | null {
  if (normalized === null || threshold === undefined || !(threshold > 0)) return null;
  return normalized / threshold;
}

export function stressScore(
  durationSeconds: number,
  intensityFactor: number | null,
): number | null {
  if (intensityFactor === null) return null;
  const secondsInAnHour = 3600;
  return rounded(((durationSeconds * intensityFactor * intensityFactor) / secondsInAnHour) * 100);
}

export function workKilojoules(samples: Samples, span: Span = wholeActivity): number | null {
  if (!hasValue(samples.power)) return null;
  let joules = 0;
  forEachHeldInterval(
    samples,
    (index, seconds) => {
      const power = samples.power[index]!;
      if (!Number.isNaN(power)) joules += power * seconds;
    },
    span,
  );
  return rounded(joules / 1000);
}
