import {
  type Activity,
  type ActivityAnalysisError,
  type ActivityEvent,
  type AnalysisStatisticName,
  analysisStatistics,
} from "@trainstack/contract";
import { isThresholdName, type Profile, thresholds, type ZoneMetric } from "@trainstack/zones";

import type { LapRow } from "./series.ts";
import { formatDay, listOfWords, thresholdWord } from "./settings.ts";
import { sportName } from "./sports.ts";
import {
  type Figure,
  type SpeedStyle,
  type Statistics,
  durationLabel,
  effortDistances,
  effortLabel,
  figureOf,
} from "./statistics.ts";

export { durationLabel };

export const ANALYSIS_POLL_MS = 10_000;

export type LoadSource = "power" | "pace" | "heart_rate";

export type AnalysisState =
  | { readonly kind: "no_file" }
  | { readonly kind: "pending" }
  | { readonly kind: "failed"; readonly error: ActivityAnalysisError }
  | { readonly kind: "analysed" };

export function analysisState(
  activity: Pick<Activity, "file" | "analyzedAt" | "analysisError">,
): AnalysisState {
  if (activity.analyzedAt !== null) return { kind: "analysed" };
  if (activity.analysisError !== null) return { kind: "failed", error: activity.analysisError };
  return activity.file === null ? { kind: "no_file" } : { kind: "pending" };
}

const stressNames = {
  power: "power_stress_tss",
  pace: "pace_stress_tss",
  heart_rate: "heart_rate_stress_tss",
} as const satisfies Record<LoadSource, AnalysisStatisticName>;

export const loadOrder = (sport: string | null): readonly LoadSource[] =>
  sport === "running" ? ["pace", "power", "heart_rate"] : ["power", "heart_rate"];

export function loadOf(statistics: Statistics, sport: string | null) {
  const stress = statistics.load_tss;
  if (stress === undefined) return null;
  const source = loadOrder(sport).find((name) => statistics[stressNames[name]] !== undefined);
  return { stress, source: source ?? null };
}

export const sourceWords: Record<LoadSource, string> = {
  power: "power",
  pace: "pace",
  heart_rate: "heart rate",
};

export function effortFigures(statistics: Statistics, sport: string | null): Figure[] {
  const speed = speedStyleOf(sport);
  const intensity =
    sport === "running" && statistics.pace_intensity_ratio !== undefined
      ? "pace_intensity_ratio"
      : "power_intensity_ratio";
  const names: readonly AnalysisStatisticName[] = [
    "load_tss",
    intensity,
    "normalized_power_w",
    "work_kj",
    "average_grade_adjusted_speed_mps",
    "normalized_grade_adjusted_speed_mps",
  ];
  return names
    .filter((name) => statistics[name] !== undefined)
    .map((name) => figureOf(name, statistics[name]!, speed));
}

export function speedStyleOf(sport: string | null): SpeedStyle {
  if (sport === "swimming") return "pace_100m";
  return sportName(sport).family === "run" ? "pace_km" : "speed";
}

export const metricOfThreshold = (threshold: string): ZoneMetric | null =>
  isThresholdName(threshold) ? thresholds[threshold].metric : null;

export interface ThresholdPrompt {
  readonly text: string;
  readonly action: string;
  readonly search: { sport?: string; metric?: ZoneMetric };
}

export interface SettingsScope {
  readonly listed: boolean;
  readonly own: readonly ZoneMetric[];
}

export function settingsScopeOf(profile: Profile, sport: string | null): SettingsScope {
  const zones = sport === null ? undefined : profile.sports[sport];
  return {
    listed: zones !== undefined,
    own: zones ? (Object.keys(zones) as ZoneMetric[]) : [],
  };
}

export function thresholdPrompt(
  activity: Pick<Activity, "missingThresholds" | "statistics" | "localDay" | "sport">,
  scope: SettingsScope,
): ThresholdPrompt | null {
  const sport = activity.sport;
  const order = loadOrder(sport);
  const load = loadOf(activity.statistics, sport);
  const better = load?.source ? order.slice(0, order.indexOf(load.source)) : order;
  const first = better.find((source) =>
    activity.missingThresholds.some((name) => metricOfThreshold(name) === source),
  );
  if (first === undefined) return null;
  const missing = activity.missingThresholds.filter((name) => metricOfThreshold(name) === first);
  const words = listOfWords(
    missing.map((name) => (isThresholdName(name) ? thresholdWord(name, sport) : name)),
  );
  const day = activity.localDay ? formatDay(activity.localDay) : "the day it was done";
  const noun = sportName(sport).noun;
  const sincePart = `Set ${missing.length > 1 ? "them" : "it"} from ${day} or earlier`;
  const addSport = first === "pace" && sport !== null && !scope.listed;
  const how = addSport
    ? `Add ${sportName(sport).label.toLowerCase()} in Settings, then set its ${words} from ${day} or earlier`
    : sincePart;
  const text = load
    ? `This ${noun}'s load is from ${load.source ? sourceWords[load.source] : "another measure"}, because your ${words} ${missing.length > 1 ? "were" : "was"} not set on ${day}. ${how} to score it from ${sourceWords[first]} instead.`
    : `This ${noun} has no load, because your ${words} ${missing.length > 1 ? "were" : "was"} not set on ${day}. ${how}, and its load follows within a minute or two.`;
  const own = sport !== null && scope.own.includes(first);
  return {
    text,
    action: addSport
      ? `Add ${sportName(sport).label.toLowerCase()}`
      : missing.length > 1
        ? "Set thresholds"
        : `Set ${words}`,
    search: addSport ? {} : own ? { sport, metric: first } : { metric: first },
  };
}

export function analysisErrorText(error: ActivityAnalysisError) {
  return error === "too_large"
    ? "This file holds more than one record a second over a week, more than Trainstack analyses, so it has no load, bests or stored zones. The charts below are read from the file in your browser."
    : "Trainstack could not analyse this file, so it has no load, bests or stored zones. The charts below are read from the file in your browser.";
}

const bestPowerPattern = /^best_power_(\d+)s_w$/;
const bestTimePattern = /^best_time_(.+)_s$/;

export const powerCurveDurations = analysisStatistics.flatMap(({ name }) => {
  const match = bestPowerPattern.exec(name);
  return match ? [{ name, seconds: Number(match[1]) }] : [];
});

export const bestEffortDistances = analysisStatistics.flatMap(({ name }) => {
  const match = bestTimePattern.exec(name);
  if (!match) return [];
  const effort = match[1]!;
  return [
    { name, effort, label: effortLabel(effort), metres: effortDistances[effort]?.metres ?? null },
  ];
});

export function activityPowerCurve(statistics: Statistics) {
  return powerCurveDurations.flatMap(({ name, seconds }) =>
    statistics[name] === undefined ? [] : [{ durationSeconds: seconds, watts: statistics[name]! }],
  );
}

export function activityBestEfforts(statistics: Statistics) {
  return bestEffortDistances.flatMap(({ name, effort }) =>
    statistics[name] === undefined ? [] : [{ name: effort, seconds: statistics[name]! }],
  );
}

const numberIn = (data: ActivityEvent["data"], name: string) => {
  const value = data[name];
  return typeof value === "number" ? value : undefined;
};

export function lapsFromEvents(events: readonly ActivityEvent[], startedAt: Date): LapRow[] {
  const rows = events
    .filter((event) => event.type === "lap")
    .map((lap, index): LapRow => {
      const { data } = lap;
      const seconds = numberIn(data, "timer_s") ?? numberIn(data, "elapsed_s");
      const distanceMetres = numberIn(data, "distance_m");
      return {
        number: index + 1,
        startSecond: (lap.startedAt.getTime() - startedAt.getTime()) / 1000,
        seconds,
        distanceMetres,
        averagePower: numberIn(data, "average_power_w"),
        maxPower: numberIn(data, "max_power_w"),
        averageHeartRate: numberIn(data, "average_heart_rate_bpm"),
        averageCadence: numberIn(data, "average_cadence_rpm"),
        averageSpeed:
          numberIn(data, "average_speed_mps") ??
          (seconds && distanceMetres !== undefined ? distanceMetres / seconds : undefined),
        normalizedPower: numberIn(data, "normalized_power_w"),
        workKilojoules: numberIn(data, "work_kj"),
        gradeAdjustedSpeed: numberIn(data, "average_grade_adjusted_speed_mps"),
      };
    });
  return rows.length > 1 ? rows : [];
}
