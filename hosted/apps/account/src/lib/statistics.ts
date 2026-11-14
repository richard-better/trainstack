import type { ActivitySummary } from "@trainstack/activity-file";
import {
  type ActivityStatisticName,
  type AnalysisStatisticName,
  analysisStatistics,
  zoneTimeStatisticPattern,
} from "@trainstack/contract";

export type StatisticName = ActivityStatisticName;
export type Statistics = Readonly<Record<string, number>>;
export type SpeedStyle = "speed" | "pace_km" | "pace_100m";

const summaryLabels = {
  timer_s: "Time",
  elapsed_s: "Elapsed",
  distance_m: "Distance",
  average_power_w: "Avg power",
  max_power_w: "Max power",
  average_heart_rate_bpm: "Avg heart rate",
  max_heart_rate_bpm: "Max heart rate",
  average_cadence_rpm: "Avg cadence",
  max_cadence_rpm: "Max cadence",
  average_speed_mps: "Avg speed",
  max_speed_mps: "Max speed",
  ascent_m: "Ascent",
  descent_m: "Descent",
  calories_kcal: "Energy",
} satisfies Record<ActivityStatisticName, string>;

type BestName = Extract<AnalysisStatisticName, `best_${string}`>;
type NamedAnalysisStatistic = Exclude<AnalysisStatisticName, BestName>;

const analysisLabels = {
  normalized_power_w: "Normalized power",
  power_intensity_ratio: "Intensity",
  power_stress_tss: "Load from power",
  work_kj: "Work",
  average_grade_adjusted_speed_mps: "Grade-adjusted speed",
  normalized_grade_adjusted_speed_mps: "Normalized grade-adjusted speed",
  pace_intensity_ratio: "Intensity",
  pace_stress_tss: "Load from pace",
  heart_rate_stress_tss: "Load from heart rate",
  sustained_max_heart_rate_bpm: "Sustained max heart rate",
  load_tss: "Load",
} satisfies Record<NamedAnalysisStatistic, string>;

const bestPowerPattern = /^best_power_(\d+)s_w$/;
const bestTimePattern = /^best_time_(.+)_s$/;
const bestSpeedPattern = /^best_grade_adjusted_speed_(\d+)s_mps$/;
const effortHeartRatePattern = /^(best_(power|time|grade_adjusted_speed)_.+)_heart_rate_bpm$/;
const effortUnits: Record<string, string> = { power: "w", time: "s", grade_adjusted_speed: "mps" };

export const effortDistances: Readonly<Record<string, { label: string; metres: number }>> = {
  "400m": { label: "400 m", metres: 400 },
  "1km": { label: "1 km", metres: 1000 },
  mile: { label: "Mile", metres: 1609.344 },
  "5km": { label: "5 km", metres: 5000 },
  "10km": { label: "10 km", metres: 10_000 },
  half_marathon: { label: "Half marathon", metres: 21_097.5 },
  marathon: { label: "Marathon", metres: 42_195 },
};

export const effortLabel = (effort: string) =>
  effortDistances[effort]?.label ?? effort.replaceAll("_", " ");

export function durationLabel(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${seconds / 60} min`;
  return `${seconds / 3600} h`;
}

const isBest = (name: AnalysisStatisticName): name is BestName => name.startsWith("best_");

function bestLabel(name: string): string {
  const heartRate = effortHeartRatePattern.exec(name);
  if (heartRate) {
    return `Heart rate in ${bestLabel(`${heartRate[1]}_${effortUnits[heartRate[2]!]}`).toLowerCase()}`;
  }
  const bestSpeed = bestSpeedPattern.exec(name);
  if (bestSpeed) return `Best ${durationLabel(Number(bestSpeed[1]))} grade-adjusted speed`;
  const bestPower = bestPowerPattern.exec(name);
  if (bestPower) return `Best ${durationLabel(Number(bestPower[1]))} power`;
  const bestTime = bestTimePattern.exec(name);
  return `Fastest ${effortLabel(bestTime?.[1] ?? name).toLowerCase()}`;
}

function analysisLabel(name: AnalysisStatisticName) {
  return isBest(name) ? bestLabel(name) : analysisLabels[name];
}

const paceLabels: Partial<Record<ActivityStatisticName | AnalysisStatisticName, string>> = {
  average_speed_mps: "Avg pace",
  max_speed_mps: "Best pace",
  average_grade_adjusted_speed_mps: "Grade-adjusted pace",
  normalized_grade_adjusted_speed_mps: "Normalized grade-adjusted pace",
};

export const statisticNames = Object.keys(summaryLabels) as ActivityStatisticName[];
const analysisNames: readonly string[] = analysisStatistics.map(({ name }) => name);

export interface Figure {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly unit: string;
}

const isSummary = (name: string): name is ActivityStatisticName =>
  (statisticNames as readonly string[]).includes(name);
const isAnalysis = (name: string): name is AnalysisStatisticName => analysisNames.includes(name);

const units = ["s", "m", "w", "bpm", "rpm", "mps", "kcal", "kj", "j", "tss", "ratio"] as const;

const unitOf = (name: string) => units.find((unit) => name.endsWith(`_${unit}`)) ?? "";

function labelOf(name: string, speed: SpeedStyle) {
  if (isSummary(name) || isAnalysis(name)) {
    const pace = speed === "speed" ? undefined : paceLabels[name];
    return pace ?? (isSummary(name) ? summaryLabels[name] : analysisLabel(name));
  }
  const words = name
    .slice(0, unitOf(name) ? -(unitOf(name).length + 1) : undefined)
    .replace(/^average_/, "avg_")
    .replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const whole = (value: number) => Math.round(value).toLocaleString("en-GB");

export function formatDuration(seconds: number) {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export function formatHours(seconds: number) {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
}

export function formatDistance(metres: number) {
  return metres < 1000
    ? { value: whole(metres), unit: "m" }
    : { value: (metres / 1000).toFixed(metres < 100_000 ? 2 : 1), unit: "km" };
}

export function formatPace(metresPerSecond: number, style: Exclude<SpeedStyle, "speed">) {
  const metres = style === "pace_km" ? 1000 : 100;
  return {
    value: metresPerSecond > 0 ? formatDuration(metres / metresPerSecond) : "-",
    unit: style === "pace_km" ? "/km" : "/100 m",
  };
}

export function formatSpeed(metresPerSecond: number, style: SpeedStyle) {
  return style === "speed"
    ? { value: (metresPerSecond * 3.6).toFixed(1), unit: "km/h" }
    : formatPace(metresPerSecond, style);
}

export const formatLoad = (stress: number) => whole(stress);

function measure(name: string, value: number, speed: SpeedStyle): Pick<Figure, "value" | "unit"> {
  switch (unitOf(name)) {
    case "s":
      return { value: formatDuration(value), unit: "" };
    case "m":
      return name.startsWith("distance")
        ? formatDistance(value)
        : { value: whole(value), unit: "m" };
    case "mps":
      return formatSpeed(value, speed);
    case "j":
      return { value: whole(value / 1000), unit: "kJ" };
    case "kj":
      return { value: whole(value), unit: "kJ" };
    case "w":
      return { value: whole(value), unit: "W" };
    case "tss":
      return { value: formatLoad(value), unit: "" };
    case "ratio":
      return { value: value.toFixed(2), unit: "" };
    case "bpm":
    case "rpm":
    case "kcal":
      return { value: whole(value), unit: unitOf(name) };
    default:
      return { value: Number.isInteger(value) ? whole(value) : value.toFixed(2), unit: "" };
  }
}

export function figureOf(name: string, value: number, speed: SpeedStyle = "speed"): Figure {
  return { name, label: labelOf(name, speed), ...measure(name, value, speed) };
}

const sameDuration = (statistics: Statistics) =>
  statistics.timer_s !== undefined &&
  statistics.elapsed_s !== undefined &&
  Math.abs(statistics.timer_s - statistics.elapsed_s) < 1;

const isZoneTime = (name: string) => zoneTimeStatisticPattern.test(name);

export function summaryFigures(statistics: Statistics, speed: SpeedStyle = "speed"): Figure[] {
  const known = statisticNames.filter(
    (name) => statistics[name] !== undefined && !(name === "elapsed_s" && sameDuration(statistics)),
  );
  const unknown = Object.keys(statistics)
    .filter((name) => !isSummary(name) && !isAnalysis(name) && !isZoneTime(name))
    .sort();
  return [...known, ...unknown].map((name) => figureOf(name, statistics[name]!, speed));
}

const headlineNames = [
  ["timer_s", "elapsed_s"],
  ["distance_m"],
  ["average_power_w"],
  ["average_heart_rate_bpm"],
] as const satisfies readonly (readonly StatisticName[])[];

export function headlineFigures(statistics: Statistics): Figure[] {
  return headlineNames.flatMap((choices) => {
    const name = choices.find((candidate) => statistics[candidate] !== undefined);
    return name ? [figureOf(name, statistics[name]!)] : [];
  });
}

export function statisticsFromFit(summary: ActivitySummary): Statistics {
  const values: Partial<Record<StatisticName, number | undefined>> = {
    timer_s: summary.timerSeconds,
    elapsed_s: summary.elapsedSeconds,
    distance_m: summary.distanceMetres,
    average_power_w: summary.averagePower,
    max_power_w: summary.maxPower,
    average_heart_rate_bpm: summary.averageHeartRate,
    max_heart_rate_bpm: summary.maxHeartRate,
    average_cadence_rpm: summary.averageCadence,
    max_cadence_rpm: summary.maxCadence,
    average_speed_mps: summary.averageSpeedMetresPerSecond,
    max_speed_mps: summary.maxSpeedMetresPerSecond,
    ascent_m: summary.totalAscentMetres,
    descent_m: summary.totalDescentMetres,
    calories_kcal: summary.calories,
  };
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, number] => entry[1] !== undefined),
  );
}
