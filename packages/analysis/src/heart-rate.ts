import { forEachHeldInterval, rounded, type Samples } from "./samples.ts";

export const trimpWeighting = { factor: 0.64, exponent: 1.92 } as const;

export interface HeartRateThresholds {
  readonly resting: number;
  readonly max: number;
  readonly lactateThreshold: number;
}

function trimpPerMinute(heartRate: number, { resting, max }: HeartRateThresholds) {
  const reserve = Math.min(1, Math.max(0, (heartRate - resting) / (max - resting)));
  return reserve * trimpWeighting.factor * Math.exp(trimpWeighting.exponent * reserve);
}

export function heartRateStressScore(
  samples: Samples,
  thresholds: HeartRateThresholds,
): number | null {
  const { resting, max, lactateThreshold } = thresholds;
  if (!(resting < lactateThreshold && lactateThreshold < max)) return null;
  let trimp = 0;
  let seconds = 0;
  forEachHeldInterval(samples, (index, duration) => {
    const heartRate = samples.heartRate[index]!;
    if (Number.isNaN(heartRate)) return;
    trimp += (duration / 60) * trimpPerMinute(heartRate, thresholds);
    seconds += duration;
  });
  if (seconds === 0) return null;
  const hourAtThreshold = 60 * trimpPerMinute(lactateThreshold, thresholds);
  return rounded((trimp / hourAtThreshold) * 100);
}
