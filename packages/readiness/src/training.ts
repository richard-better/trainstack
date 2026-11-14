import { type DailyLoad, fitnessDays, trainingLoad } from "@trainstack/analysis";

import { daysBetween, shiftDay } from "./day.ts";
import type { Effect } from "./check-in.ts";

export const loadHistoryDays = 2 * fitnessDays;
export const minimumFitness = 10;
export const freshFormShare = 0.05;
export const buildingFormShare = -0.1;
export const deepFormShare = -0.3;
export const fastRampPerWeek = 8;
export const hardDayShare = 1.5;

export type FormBand = "fresh" | "neutral" | "building" | "deep";

export type TrainingReason =
  | {
      readonly kind: "form";
      readonly form: number;
      readonly fitness: number;
      readonly share: number;
      readonly band: FormBand;
      readonly effect: Effect;
      readonly weight: number;
    }
  | {
      readonly kind: "ramp";
      readonly perWeek: number;
      readonly effect: Effect;
      readonly weight: number;
    }
  | {
      readonly kind: "hard_days";
      readonly days: number;
      readonly effect: Effect;
      readonly weight: number;
    };

export type TrainingGap =
  | { readonly kind: "no_training" }
  | { readonly kind: "short_training_history"; readonly days: number }
  | { readonly kind: "little_training"; readonly fitness: number };

export interface TrainingState {
  readonly fitness: number;
  readonly historyDays: number;
  readonly reasons: TrainingReason[];
  readonly gap: TrainingGap | null;
}

export interface LoadSeries {
  readonly firstDay: string | null;
  readonly byDay: ReadonlyMap<string, DailyLoad>;
}

export function loadSeries(stress: ReadonlyMap<string, number>, through: string): LoadSeries {
  const days = [...stress.keys()].filter((day) => day <= through).sort();
  const firstDay = days[0] ?? null;
  if (firstDay === null) return { firstDay, byDay: new Map() };
  return {
    firstDay,
    byDay: new Map(trainingLoad(stress, firstDay, through).map((load) => [load.day, load])),
  };
}

export const isHardLoad = (load: number, fitness: number) =>
  fitness >= minimumFitness && load >= hardDayShare * fitness;

function formBandOf(share: number): FormBand {
  if (share > freshFormShare) return "fresh";
  if (share >= buildingFormShare) return "neutral";
  if (share >= deepFormShare) return "building";
  return "deep";
}

function hardDaysBefore(series: LoadSeries, day: string) {
  let count = 0;
  for (let back = 1; ; back++) {
    const done = series.byDay.get(shiftDay(day, -back));
    const entering = series.byDay.get(shiftDay(day, -back - 1));
    if (!done || !isHardLoad(done.stress, entering?.fitness ?? 0)) return count;
    count += 1;
  }
}

export function trainingState(series: LoadSeries, day: string): TrainingState {
  const entering = series.byDay.get(shiftDay(day, -1));
  if (series.firstDay === null || series.firstDay >= day || !entering) {
    return { fitness: 0, historyDays: 0, reasons: [], gap: { kind: "no_training" } };
  }
  const historyDays = daysBetween(series.firstDay, day);
  const fitness = entering.fitness;
  if (historyDays < loadHistoryDays) {
    return {
      fitness,
      historyDays,
      reasons: [],
      gap: { kind: "short_training_history", days: historyDays },
    };
  }
  if (fitness < minimumFitness) {
    return { fitness, historyDays, reasons: [], gap: { kind: "little_training", fitness } };
  }
  const reasons: TrainingReason[] = [];
  const share = entering.form / fitness;
  const band = formBandOf(share);
  reasons.push({
    kind: "form",
    form: entering.form,
    fitness,
    share,
    band,
    effect: band === "deep" ? "lowers" : band === "fresh" ? "raises" : "steady",
    weight: band === "deep" ? 2 : 0,
  });
  const weekBefore = series.byDay.get(shiftDay(day, -8));
  const perWeek = fitness - (weekBefore?.fitness ?? 0);
  if (perWeek > fastRampPerWeek) {
    reasons.push({ kind: "ramp", perWeek, effect: "lowers", weight: 1 });
  }
  const hardDays = hardDaysBefore(series, day);
  if (hardDays >= 2) {
    reasons.push({
      kind: "hard_days",
      days: hardDays,
      effect: "lowers",
      weight: hardDays >= 3 ? 2 : 1,
    });
  }
  return { fitness, historyDays, reasons, gap: null };
}
