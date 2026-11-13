import type { ActivitySummary } from "@trainstack/fit";

export const statisticNames = [
  "timer_s",
  "elapsed_s",
  "distance_m",
  "average_power_w",
  "max_power_w",
  "average_heart_rate_bpm",
  "max_heart_rate_bpm",
  "average_cadence_rpm",
  "max_cadence_rpm",
  "average_speed_mps",
  "max_speed_mps",
  "ascent_m",
  "descent_m",
  "calories_kcal",
] as const;

export type StatisticName = (typeof statisticNames)[number];
export type Statistics = Readonly<Record<string, number>>;

const labels: Record<StatisticName, string> = {
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
};

export interface Figure {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly unit: string;
}

const isKnown = (name: string): name is StatisticName =>
  (statisticNames as readonly string[]).includes(name);

const units = ["s", "m", "w", "bpm", "rpm", "mps", "kcal", "j"] as const;

const unitOf = (name: string) => units.find((unit) => name.endsWith(`_${unit}`)) ?? "";

function labelOf(name: string) {
  if (isKnown(name)) return labels[name];
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

export function formatDistance(metres: number) {
  return metres < 1000
    ? { value: whole(metres), unit: "m" }
    : { value: (metres / 1000).toFixed(metres < 100_000 ? 2 : 1), unit: "km" };
}

function measure(name: string, value: number): Pick<Figure, "value" | "unit"> {
  switch (unitOf(name)) {
    case "s":
      return { value: formatDuration(value), unit: "" };
    case "m":
      return name.startsWith("distance")
        ? formatDistance(value)
        : { value: whole(value), unit: "m" };
    case "mps":
      return { value: (value * 3.6).toFixed(1), unit: "km/h" };
    case "j":
      return { value: whole(value / 1000), unit: "kJ" };
    case "w":
      return { value: whole(value), unit: "W" };
    case "bpm":
    case "rpm":
    case "kcal":
      return { value: whole(value), unit: unitOf(name) };
    default:
      return { value: Number.isInteger(value) ? whole(value) : value.toFixed(2), unit: "" };
  }
}

export function figureOf(name: string, value: number): Figure {
  return { name, label: labelOf(name), ...measure(name, value) };
}

const sameDuration = (statistics: Statistics) =>
  statistics.timer_s !== undefined &&
  statistics.elapsed_s !== undefined &&
  Math.abs(statistics.timer_s - statistics.elapsed_s) < 1;

export function summaryFigures(statistics: Statistics): Figure[] {
  const known = statisticNames.filter(
    (name) => statistics[name] !== undefined && !(name === "elapsed_s" && sameDuration(statistics)),
  );
  const unknown = Object.keys(statistics)
    .filter((name) => !isKnown(name))
    .sort();
  return [...known, ...unknown].map((name) => figureOf(name, statistics[name]!));
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
