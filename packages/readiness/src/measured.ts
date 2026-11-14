import { baselineOf, type BaselineWindow, type DatedValue } from "./baseline.ts";
import type { Effect } from "./check-in.ts";
import { daysBetween } from "./day.ts";
import { type Measure, measures, type MeasuredDay } from "./inputs.ts";

export const sleepBaseline: BaselineWindow = { days: 28, minimum: 7 };
export const restingHeartRateBaseline: BaselineWindow = { days: 28, minimum: 7 };
export const hrvBaseline: BaselineWindow = { days: 60, minimum: 14 };

export const sleepShortBySeconds = 3600;
export const sleepMuchShortBySeconds = 2 * 3600;
export const restingHeartRateUpBy = 5;
export const restingHeartRateMuchUpBy = 10;
export const hrvDownBy = 1.5;
export const hrvMuchDownBy = 2.5;
export const hrvSmallestSpread = 0.1;
export const maxMeasuredWeight = 3;

export interface MeasuredReason {
  readonly kind: "measured";
  readonly item: Measure;
  readonly value: number;
  readonly usual: number;
  readonly difference: number;
  readonly effect: Effect;
  readonly weight: number;
}

export interface MeasuredGap {
  readonly kind: "short_measured_baseline";
  readonly item: Measure;
  readonly days: number;
}

const field = {
  sleep: "sleepSeconds",
  resting_heart_rate: "restingHeartRateBpm",
  hrv: "hrvMs",
} as const satisfies Record<Measure, keyof MeasuredDay>;

const windows: Record<Measure, BaselineWindow> = {
  sleep: sleepBaseline,
  resting_heart_rate: restingHeartRateBaseline,
  hrv: hrvBaseline,
};

const valueOf = (day: MeasuredDay | undefined, item: Measure) => {
  const value = day?.[field[item]];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
};

function history(
  days: readonly MeasuredDay[],
  item: Measure,
  transform = (value: number) => value,
) {
  return days.flatMap((day): DatedValue[] => {
    const value = valueOf(day, item);
    return value === null ? [] : [{ day: day.day, value: transform(value) }];
  });
}

function spreadOf(
  values: readonly DatedValue[],
  day: string,
  window: BaselineWindow,
  mean: number,
) {
  let sum = 0;
  let count = 0;
  for (const { day: on, value } of values) {
    const before = daysBetween(on, day);
    if (before < 1 || before > window.days) continue;
    sum += (value - mean) ** 2;
    count += 1;
  }
  return Math.max(Math.sqrt(sum / Math.max(count - 1, 1)), hrvSmallestSpread);
}

const rounded = (value: number, step: number) => Math.round(value / step) * step;

function reasonFor(
  item: Measure,
  value: number,
  days: readonly MeasuredDay[],
  day: string,
): MeasuredReason | MeasuredGap {
  const window = windows[item];
  const values = item === "hrv" ? history(days, item, Math.log) : history(days, item);
  const baseline = baselineOf(values, day, window);
  if (!baseline) {
    const count = values.filter(({ day: on }) => {
      const before = daysBetween(on, day);
      return before >= 1 && before <= window.days;
    }).length;
    return { kind: "short_measured_baseline", item, days: count };
  }
  if (item === "hrv") {
    const usual = Math.exp(baseline.mean);
    const spread = spreadOf(values, day, window, baseline.mean);
    const score = (Math.log(value) - baseline.mean) / spread;
    const weight = score <= -hrvMuchDownBy ? 2 : score <= -hrvDownBy ? 1 : 0;
    const effect: Effect = weight > 0 ? "lowers" : score >= hrvDownBy ? "raises" : "steady";
    return {
      kind: "measured",
      item,
      value,
      usual: rounded(usual, 0.1),
      difference: rounded(value - usual, 0.1),
      effect,
      weight,
    };
  }
  if (item === "sleep") {
    const difference = value - baseline.mean;
    const weight =
      difference <= -sleepMuchShortBySeconds ? 2 : difference <= -sleepShortBySeconds ? 1 : 0;
    const effect: Effect =
      weight > 0 ? "lowers" : difference >= sleepShortBySeconds ? "raises" : "steady";
    return {
      kind: "measured",
      item,
      value,
      usual: rounded(baseline.mean, 60),
      difference: rounded(difference, 60),
      effect,
      weight,
    };
  }
  const difference = value - baseline.mean;
  const weight =
    difference >= restingHeartRateMuchUpBy ? 2 : difference >= restingHeartRateUpBy ? 1 : 0;
  const effect: Effect =
    weight > 0 ? "lowers" : difference <= -restingHeartRateUpBy ? "raises" : "steady";
  return {
    kind: "measured",
    item,
    value,
    usual: rounded(baseline.mean, 0.1),
    difference: rounded(difference, 0.1),
    effect,
    weight,
  };
}

export interface MeasuredState {
  readonly reasons: MeasuredReason[];
  readonly gaps: MeasuredGap[];
  readonly unmeasured: Measure[];
}

export function measuredState(
  days: readonly MeasuredDay[],
  byDay: ReadonlyMap<string, MeasuredDay>,
  day: string,
): MeasuredState {
  const today = byDay.get(day);
  const reasons: MeasuredReason[] = [];
  const gaps: MeasuredGap[] = [];
  const unmeasured: Measure[] = [];
  for (const item of measures) {
    const value = valueOf(today, item);
    if (value === null) {
      unmeasured.push(item);
      continue;
    }
    const read = reasonFor(item, value, days, day);
    if (read.kind === "measured") reasons.push(read);
    else gaps.push(read);
  }
  return { reasons, gaps, unmeasured };
}
