import type { BestEffort, BestEffortName } from "./running.ts";
import { forEachHeldInterval, prefixSums, rounded, type Samples, type Span } from "./samples.ts";

export const sustainedHeartRateSeconds = 5;
export const powerEffortHeartRateDurations = [1200, 1800] as const;
export const gradeAdjustedSpeedDurations = [1800] as const;
export const effortHeartRateShare = 2 / 3;
export const minEffortHeartRateCoverage = 0.8;

export interface EffortHeartRate {
  readonly durationSeconds: number;
  readonly heartRate: number;
}

export interface BestGradeAdjustedSpeed {
  readonly durationSeconds: number;
  readonly speed: number;
  readonly heartRate: number | null;
}

export interface BestEffortHeartRate {
  readonly name: BestEffortName;
  readonly heartRate: number;
}

export function sustainedMaxHeartRate(samples: Samples): number | null {
  const { held, heartRate } = samples;
  const pulse = (segment: number) => heartRate[held.record[segment]!]!;
  const lowest = new Int32Array(held.count);
  let best = -Infinity;
  for (let chain = 0; chain < held.count;) {
    if (Number.isNaN(pulse(chain))) {
      chain++;
      continue;
    }
    let end = chain;
    while (
      end + 1 < held.count &&
      held.start[end + 1] === held.end[end] &&
      !Number.isNaN(pulse(end + 1))
    ) {
      end++;
    }
    let head = 0;
    let tail = 0;
    lowest[tail++] = chain;
    let last = chain;
    for (let first = chain; first <= end; first++) {
      while (lowest[head]! < first) head++;
      while (
        last < end &&
        (last === first || held.end[last]! - held.start[first]! < sustainedHeartRateSeconds)
      ) {
        last++;
        while (tail > head && pulse(lowest[tail - 1]!) >= pulse(last)) tail--;
        lowest[tail++] = last;
      }
      if (last === first || held.end[last]! - held.start[first]! < sustainedHeartRateSeconds) break;
      best = Math.max(best, pulse(lowest[head]!));
    }
    chain = end + 1;
  }
  return Number.isFinite(best) ? rounded(best) : null;
}

export function effortHeartRate(samples: Samples, span: Span): number | null {
  const from = span.to - (span.to - span.from) * effortHeartRateShare;
  let total = 0;
  let seconds = 0;
  forEachHeldInterval(
    samples,
    (index, duration) => {
      const value = samples.heartRate[index]!;
      if (Number.isNaN(value)) return;
      total += value * duration;
      seconds += duration;
    },
    { from, to: span.to },
  );
  return seconds >= (span.to - from) * minEffortHeartRateCoverage ? rounded(total / seconds) : null;
}

export function bestWindow(sums: Float64Array, seconds: number) {
  const length = sums.length - 1;
  if (seconds <= 0 || seconds > length) return null;
  let bestEnd = seconds;
  for (let end = seconds + 1; end <= length; end++) {
    if (sums[end]! - sums[end - seconds]! > sums[bestEnd]! - sums[bestEnd - seconds]!)
      bestEnd = end;
  }
  return {
    span: { from: bestEnd - seconds, to: bestEnd },
    average: (sums[bestEnd]! - sums[bestEnd - seconds]!) / seconds,
  };
}

export function powerEffortHeartRates(
  samples: Samples,
  powerPerSecond: Float64Array,
): EffortHeartRate[] {
  const sums = prefixSums(powerPerSecond);
  return powerEffortHeartRateDurations.flatMap((durationSeconds) => {
    const window = bestWindow(sums, durationSeconds);
    const heartRate = window && effortHeartRate(samples, window.span);
    return heartRate === null ? [] : [{ durationSeconds, heartRate }];
  });
}

export function bestGradeAdjustedSpeeds(
  samples: Samples,
  gradeAdjustedPerSecond: Float64Array,
): BestGradeAdjustedSpeed[] {
  const sums = prefixSums(gradeAdjustedPerSecond);
  return gradeAdjustedSpeedDurations.flatMap((durationSeconds) => {
    const window = bestWindow(sums, durationSeconds);
    if (!window || !(window.average > 0)) return [];
    return [
      {
        durationSeconds,
        speed: window.average,
        heartRate: effortHeartRate(samples, window.span),
      },
    ];
  });
}

export function bestEffortHeartRates(
  samples: Samples,
  efforts: readonly BestEffort[],
): BestEffortHeartRate[] {
  return efforts.flatMap(({ name, startSeconds, endSeconds }) => {
    const heartRate = effortHeartRate(samples, { from: startSeconds, to: endSeconds });
    return heartRate === null ? [] : [{ name, heartRate }];
  });
}
