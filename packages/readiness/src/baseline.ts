import { daysBetween } from "./day.ts";

export interface DatedValue {
  readonly day: string;
  readonly value: number;
}

export interface Baseline {
  readonly mean: number;
  readonly count: number;
}

export interface BaselineWindow {
  readonly days: number;
  readonly minimum: number;
}

export function baselineOf(
  values: readonly DatedValue[],
  day: string,
  window: BaselineWindow,
): Baseline | null {
  let sum = 0;
  let count = 0;
  for (const value of values) {
    const before = daysBetween(value.day, day);
    if (before < 1 || before > window.days || !Number.isFinite(value.value)) continue;
    sum += value.value;
    count += 1;
  }
  return count >= window.minimum ? { mean: sum / count, count } : null;
}
