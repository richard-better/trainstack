import type { ActivityRecord } from "@trainstack/activity-file";

import { metresBetween } from "./route.ts";

type Located = Pick<
  ActivityRecord,
  "elapsedSeconds" | "distanceMetres" | "latitude" | "longitude" | "altitudeMetres"
>;

export interface Elevation {
  readonly values: readonly (number | null)[];
  readonly min: number;
  readonly max: number;
  readonly ascent: number;
  readonly descent: number;
}

export const CLIMB_THRESHOLD_METRES = 3;
const GRADE_HALF_WINDOW_METRES = 50;
const GRADE_MIN_RUN_METRES = 40;
const STEEPEST_GRADE = 35;

export function distancesOf(records: readonly Located[]): readonly number[] | null {
  if (records.some((record) => record.distanceMetres !== undefined)) {
    let last = 0;
    return records.map((record) => {
      if (record.distanceMetres !== undefined) last = Math.max(last, record.distanceMetres);
      return last;
    });
  }
  let total = 0;
  let previous: { latitude: number; longitude: number } | null = null;
  let moved = false;
  const distances = records.map((record) => {
    if (record.latitude === undefined || record.longitude === undefined) return total;
    const here = { latitude: record.latitude, longitude: record.longitude };
    if (previous) total += metresBetween(previous, here);
    if (total > 0) moved = true;
    previous = here;
    return total;
  });
  return moved ? distances : null;
}

export function elevationOf(records: readonly Located[]): Elevation | null {
  const values = records.map((record) => record.altitudeMetres ?? null);
  let min = Infinity;
  let max = -Infinity;
  let reference: number | null = null;
  let ascent = 0;
  let descent = 0;
  for (const value of values) {
    if (value === null) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
    if (reference === null) reference = value;
    else if (value - reference >= CLIMB_THRESHOLD_METRES) {
      ascent += value - reference;
      reference = value;
    } else if (reference - value >= CLIMB_THRESHOLD_METRES) {
      descent += reference - value;
      reference = value;
    }
  }
  if (!(max > min)) return null;
  return { values, min, max, ascent, descent };
}

export function gradesOf(
  distances: readonly number[],
  altitudes: readonly (number | null)[],
): (number | null)[] {
  let back = 0;
  let ahead = 0;
  return distances.map((distance, index) => {
    while (distances[back]! < distance - GRADE_HALF_WINDOW_METRES) back++;
    while (
      ahead + 1 < distances.length &&
      distances[ahead + 1]! <= distance + GRADE_HALF_WINDOW_METRES
    ) {
      ahead++;
    }
    let from = back;
    while (from < index && altitudes[from] === null) from++;
    let to = ahead;
    while (to > index && altitudes[to] === null) to--;
    const run = distances[to]! - distances[from]!;
    const rise = (altitudes[to] ?? NaN) - (altitudes[from] ?? NaN);
    if (!(run >= GRADE_MIN_RUN_METRES) || !Number.isFinite(rise)) return null;
    return Math.max(-STEEPEST_GRADE, Math.min(STEEPEST_GRADE, (rise / run) * 100));
  });
}
