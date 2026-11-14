import type { LoggedExercise, SetLoad, StrengthDetail, StrengthSet } from "./strength.ts";
import { kilogramsOf, type MassUnit } from "./units.ts";

export const EPLEY_MAX_REPS = 12;

export function loadKilograms(load: SetLoad, bodyMassKg: number | null) {
  switch (load.kind) {
    case "weight":
      return kilogramsOf(load.weight);
    case "bodyweight":
      return bodyMassKg;
    case "weighted":
      return bodyMassKg === null ? null : bodyMassKg + kilogramsOf(load.added);
    case "assisted":
      return bodyMassKg === null ? null : Math.max(0, bodyMassKg - kilogramsOf(load.assistance));
  }
}

export function epleyOneRepMax(kilograms: number, reps: number) {
  if (reps < 1 || reps > EPLEY_MAX_REPS) return null;
  return reps === 1 ? kilograms : kilograms * (1 + reps / 30);
}

export const countsTowardNumbers = (set: StrengthSet) => set.kind !== "warm_up";

export type ExerciseNumbers = {
  exerciseId: string;
  sets: number;
  reps: number;
  volumeKg: number | null;
  heaviestKg: number | null;
  estimatedOneRepMaxKg: number | null;
  mostReps: number | null;
  longestSeconds: number | null;
};

const maxOf = (values: (number | null)[]) => {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : Math.max(...known);
};

export function exerciseNumbers(
  entry: LoggedExercise,
  bodyMassKg: number | null = null,
): ExerciseNumbers {
  const counted = entry.sets.filter(countsTowardNumbers);
  const loaded = counted.map((set) => ({ set, kg: loadKilograms(set.load, bodyMassKg) }));
  const withReps = loaded.filter(({ set }) => set.reps !== null && set.reps > 0);
  const volumes = withReps.filter(({ kg }) => kg !== null).map(({ set, kg }) => set.reps! * kg!);
  return {
    exerciseId: entry.exerciseId,
    sets: counted.length,
    reps: counted.reduce((sum, set) => sum + (set.reps ?? 0), 0),
    volumeKg: volumes.length === 0 ? null : volumes.reduce((sum, volume) => sum + volume, 0),
    heaviestKg: maxOf(
      loaded.filter(({ set }) => (set.reps ?? 0) > 0 || (set.seconds ?? 0) > 0).map(({ kg }) => kg),
    ),
    estimatedOneRepMaxKg: maxOf(
      withReps.map(({ set, kg }) => (kg === null ? null : epleyOneRepMax(kg, set.reps!))),
    ),
    mostReps: maxOf(counted.map((set) => set.reps)),
    longestSeconds: maxOf(counted.map((set) => set.seconds)),
  };
}

export function mergedNumbers(numbers: ExerciseNumbers[]): ExerciseNumbers[] {
  const byExercise = new Map<string, ExerciseNumbers>();
  for (const next of numbers) {
    const seen = byExercise.get(next.exerciseId);
    if (!seen) {
      byExercise.set(next.exerciseId, { ...next });
      continue;
    }
    const sum = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b);
    byExercise.set(next.exerciseId, {
      exerciseId: next.exerciseId,
      sets: seen.sets + next.sets,
      reps: seen.reps + next.reps,
      volumeKg: sum(seen.volumeKg, next.volumeKg),
      heaviestKg: maxOf([seen.heaviestKg, next.heaviestKg]),
      estimatedOneRepMaxKg: maxOf([seen.estimatedOneRepMaxKg, next.estimatedOneRepMaxKg]),
      mostReps: maxOf([seen.mostReps, next.mostReps]),
      longestSeconds: maxOf([seen.longestSeconds, next.longestSeconds]),
    });
  }
  return [...byExercise.values()];
}

export type StrengthSummary = {
  sport: "strength";
  exercises: number;
  sets: number;
  reps: number;
  volumeKg: number | null;
  unit: MassUnit;
};

export function strengthNumbers(detail: StrengthDetail, bodyMassKg: number | null = null) {
  return mergedNumbers(detail.exercises.map((entry) => exerciseNumbers(entry, bodyMassKg)));
}

export function preferredUnit(detail: StrengthDetail): MassUnit {
  let pounds = 0;
  let kilograms = 0;
  for (const { sets } of detail.exercises) {
    for (const { load } of sets) {
      const mass =
        load.kind === "weight"
          ? load.weight
          : load.kind === "weighted"
            ? load.added
            : load.kind === "assisted"
              ? load.assistance
              : null;
      if (mass?.unit === "lb") pounds++;
      if (mass?.unit === "kg") kilograms++;
    }
  }
  return pounds > kilograms ? "lb" : "kg";
}

export function strengthSummary(
  detail: StrengthDetail,
  bodyMassKg: number | null = null,
): StrengthSummary {
  const numbers = strengthNumbers(detail, bodyMassKg);
  const volumes = numbers.map(({ volumeKg }) => volumeKg).filter((volume) => volume !== null);
  return {
    sport: "strength",
    exercises: numbers.length,
    sets: numbers.reduce((sum, { sets }) => sum + sets, 0),
    reps: numbers.reduce((sum, { reps }) => sum + reps, 0),
    volumeKg: volumes.length === 0 ? null : volumes.reduce((sum, volume) => sum + volume, 0),
    unit: preferredUnit(detail),
  };
}

export const recordKinds = [
  "estimated_one_rep_max",
  "heaviest",
  "volume",
  "most_reps",
  "longest",
] as const;
export type RecordKind = (typeof recordKinds)[number];

const recordValue: Record<RecordKind, (numbers: ExerciseNumbers) => number | null> = {
  estimated_one_rep_max: (numbers) => numbers.estimatedOneRepMaxKg,
  heaviest: (numbers) => numbers.heaviestKg,
  volume: (numbers) => numbers.volumeKg,
  most_reps: (numbers) => numbers.mostReps,
  longest: (numbers) => numbers.longestSeconds,
};

export type PersonalRecord = {
  exerciseId: string;
  kind: RecordKind;
  value: number;
  previous: number;
};

export function personalRecords(
  session: ExerciseNumbers[],
  earlier: ExerciseNumbers[],
): PersonalRecord[] {
  const best = new Map<string, number>();
  for (const numbers of earlier) {
    for (const kind of recordKinds) {
      const value = recordValue[kind](numbers);
      if (value === null) continue;
      const key = `${numbers.exerciseId}\u0000${kind}`;
      best.set(key, Math.max(best.get(key) ?? value, value));
    }
  }
  const records: PersonalRecord[] = [];
  for (const numbers of session) {
    for (const kind of recordKinds) {
      const value = recordValue[kind](numbers);
      const previous = best.get(`${numbers.exerciseId}\u0000${kind}`);
      if (value !== null && previous !== undefined && value > previous) {
        records.push({ exerciseId: numbers.exerciseId, kind, value, previous });
      }
    }
  }
  return records;
}
