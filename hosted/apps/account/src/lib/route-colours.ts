import type { Route } from "./route.ts";
import type { Trace } from "./series.ts";
import { type SpeedStyle, formatSpeed } from "./statistics.ts";
import { type Elevation, gradesOf } from "./terrain.ts";

export type RouteMeasure = "speed" | "power" | "heartRate" | "grade";

export interface Band {
  readonly color: string;
  readonly from: number | null;
  readonly to: number | null;
}

export interface ColouredRun {
  readonly color: string;
  readonly coordinates: readonly (readonly [longitude: number, latitude: number])[];
}

export const PLAIN_ROUTE = "#f2f2f3";
export const UNMEASURED = "#5a5c61";
export const MAGNITUDE_RAMP = ["#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4", "#cde2fb"];
const GRADE_EDGES = [-8, -4, -1, 1, 4, 8];
const GRADE_RAMP = ["#2a78d6", "#5598e7", "#9ec5f4", "#8e9096", "#f2b8b5", "#ec8a87", "#e34948"];

function quantile(sorted: readonly number[], at: number) {
  const position = (sorted.length - 1) * at;
  const below = Math.floor(position);
  const above = Math.ceil(position);
  return sorted[below]! + (sorted[above]! - sorted[below]!) * (position - below);
}

function bandsBetween(edges: readonly number[], colors: readonly string[]): Band[] {
  return colors.map((color, index) => ({
    color,
    from: index === 0 ? null : edges[index - 1]!,
    to: index === colors.length - 1 ? null : edges[index]!,
  }));
}

export function magnitudeBands(values: readonly (number | null)[]): Band[] {
  const sorted = values
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const low = quantile(sorted, 0.05);
  const high = quantile(sorted, 0.95);
  if (!(high > low)) return [{ color: MAGNITUDE_RAMP[3]!, from: null, to: null }];
  const steps = MAGNITUDE_RAMP.length;
  const edges = Array.from(
    { length: steps - 1 },
    (_, index) => low + ((index + 1) * (high - low)) / steps,
  );
  return bandsBetween(edges, MAGNITUDE_RAMP);
}

export const gradeBands = (): Band[] => bandsBetween(GRADE_EDGES, GRADE_RAMP);

export function bandOf(bands: readonly Band[], value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  const found = bands.find((band) => band.to === null || value < band.to);
  return found ?? null;
}

export function colouredRuns(
  route: Route,
  values: readonly (number | null)[] | null,
  bands: readonly Band[],
): ColouredRun[] {
  const runs: ColouredRun[] = [];
  for (const segment of route.segments) {
    let color: string | null = null;
    let coordinates: (readonly [number, number])[] = [];
    for (const point of segment) {
      const here = [point.longitude, point.latitude] as const;
      const next = values
        ? (bandOf(bands, values[point.record] ?? null)?.color ?? UNMEASURED)
        : PLAIN_ROUTE;
      if (color !== null && next !== color) {
        coordinates.push(here);
        runs.push({ color, coordinates });
        coordinates = [];
      }
      color = next;
      coordinates.push(here);
    }
    if (color !== null) {
      runs.push({
        color,
        coordinates: coordinates.length > 1 ? coordinates : [...coordinates, ...coordinates],
      });
    }
  }
  return runs;
}

export interface MeasureOption {
  readonly key: RouteMeasure;
  readonly label: string;
  readonly values: readonly (number | null)[];
  readonly bands: readonly Band[];
  readonly format: (value: number) => string;
  readonly unit: string;
}

const whole = (value: number) => Math.round(value).toLocaleString("en-GB");

export function routeMeasures(
  trace: Pick<Trace, "channels" | "distances">,
  elevation: Elevation | null,
  speed: SpeedStyle,
): MeasureOption[] {
  const channel = (key: string) => trace.channels.find((found) => found.key === key);
  const options: MeasureOption[] = [];
  const speedChannel = channel("speed");
  if (speedChannel) {
    options.push({
      key: "speed",
      label: speed === "speed" ? "Speed" : "Pace",
      values: speedChannel.values,
      bands: magnitudeBands(speedChannel.values),
      format: (value) => formatSpeed(value / 3.6, speed).value,
      unit: formatSpeed(1, speed).unit,
    });
  }
  const power = channel("power");
  if (power) {
    options.push({
      key: "power",
      label: "Power",
      values: power.values,
      bands: magnitudeBands(power.values),
      format: whole,
      unit: "W",
    });
  }
  const heartRate = channel("heartRate");
  if (heartRate) {
    options.push({
      key: "heartRate",
      label: "Heart rate",
      values: heartRate.values,
      bands: magnitudeBands(heartRate.values),
      format: whole,
      unit: "bpm",
    });
  }
  if (elevation && trace.distances) {
    const grades = gradesOf(trace.distances, elevation.values);
    if (grades.some((grade) => grade !== null)) {
      options.push({
        key: "grade",
        label: "Grade",
        values: grades,
        bands: gradeBands(),
        format: (value) => String(value),
        unit: "%",
      });
    }
  }
  return options;
}
