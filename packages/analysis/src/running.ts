import type { Samples } from "./samples.ts";

export const gradeWindowMetres = 100;
export const minGradeSpanMetres = 10;
export const maxGrade = 0.45;

export function minettiCost(grade: number): number {
  const i = Math.min(maxGrade, Math.max(-maxGrade, grade));
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
}

export const gradeAdjustment = (grade: number) => minettiCost(grade) / minettiCost(0);

function interpolator(distances: Float64Array, values: Float64Array) {
  const last = distances.length - 1;
  let below = 0;
  return (distance: number) => {
    if (distance <= distances[0]!) return values[0]!;
    if (distance >= distances[last]!) return values[last]!;
    while (distances[below + 1]! < distance) below++;
    const share = (distance - distances[below]!) / (distances[below + 1]! - distances[below]!);
    return values[below]! + share * (values[below + 1]! - values[below]!);
  };
}

function whereBothAreKnown(keys: Float64Array, values: Float64Array, count: number) {
  let known = 0;
  for (let index = 0; index < count; index++) {
    if (!Number.isNaN(keys[index]!) && !Number.isNaN(values[index]!)) known++;
  }
  const knownKeys = new Float64Array(known);
  const knownValues = new Float64Array(known);
  for (let index = 0, next = 0; index < count; index++) {
    if (Number.isNaN(keys[index]!) || Number.isNaN(values[index]!)) continue;
    knownKeys[next] = keys[index]!;
    knownValues[next] = values[index]!;
    next++;
  }
  return { keys: knownKeys, values: knownValues };
}

function profileOf(samples: Samples) {
  const { keys, values } = whereBothAreKnown(samples.distance, samples.altitude, samples.count);
  return { distances: keys, altitudes: values };
}

export function grades(samples: Samples): Float64Array {
  const result = new Float64Array(samples.count);
  const { distances, altitudes } = profileOf(samples);
  if (distances.length < 2) return result;
  const first = distances[0]!;
  const last = distances[distances.length - 1]!;
  const behind = interpolator(distances, altitudes);
  const ahead = interpolator(distances, altitudes);
  const half = gradeWindowMetres / 2;
  let grade = 0;
  for (let index = 0; index < samples.count; index++) {
    const distance = samples.distance[index]!;
    if (!Number.isNaN(distance)) {
      const from = Math.max(first, distance - half);
      const to = Math.min(last, distance + half);
      grade =
        to - from >= minGradeSpanMetres
          ? Math.min(maxGrade, Math.max(-maxGrade, (ahead(to) - behind(from)) / (to - from)))
          : 0;
    }
    result[index] = grade;
  }
  return result;
}

export function gradeAdjustedSpeeds(samples: Samples): Float64Array {
  const adjusted = grades(samples);
  for (let index = 0; index < samples.count; index++) {
    adjusted[index] = samples.speed[index]! * gradeAdjustment(adjusted[index]!);
  }
  return adjusted;
}

export const bestEffortDistances = [
  { name: "400m", metres: 400 },
  { name: "1km", metres: 1000 },
  { name: "mile", metres: 1609.344 },
  { name: "5km", metres: 5000 },
  { name: "10km", metres: 10_000 },
  { name: "half_marathon", metres: 21_097.5 },
  { name: "marathon", metres: 42_195 },
] as const;

export type BestEffortName = (typeof bestEffortDistances)[number]["name"];

export interface BestEffort {
  readonly name: BestEffortName;
  readonly distanceMetres: number;
  readonly seconds: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export function bestEfforts(samples: Samples): BestEffort[] {
  const { keys: distances, values: times } = whereBothAreKnown(
    samples.distance,
    samples.elapsed,
    samples.count,
  );
  const efforts: BestEffort[] = [];
  for (const { name, metres } of bestEffortDistances) {
    let best: BestEffort | null = null;
    let start = 0;
    for (let end = 1; end < distances.length; end++) {
      while (start + 1 < end && distances[end]! - distances[start + 1]! >= metres) start++;
      const covered = distances[end]! - distances[start]!;
      if (covered < metres) continue;
      const from = distances[end]! - metres;
      const share = (from - distances[start]!) / (distances[start + 1]! - distances[start]!);
      const startSeconds = times[start]! + share * (times[start + 1]! - times[start]!);
      const seconds = times[end]! - startSeconds;
      if (best === null || seconds < best.seconds) {
        best = { name, distanceMetres: metres, seconds, startSeconds, endSeconds: times[end]! };
      }
    }
    if (best) efforts.push(best);
  }
  return efforts;
}
