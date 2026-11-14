import type { BuiltinWorkout, BuiltinWorkoutSummary } from "@trainstack/contract";
import { type Focus, type Workout, workoutSchema } from "@trainstack/workout";

import rideLibrary from "./ride-library.json";
import { searchTerms, slugOf, summaryOf } from "./summary";

type RideTemplate = {
  name: string;
  category: number;
  about: string;
  steps: { duration: number; intensity: number }[];
  cues?: { step: number; at: number; text: string }[];
};

const rideCategories: Focus[] = [
  "recovery",
  "endurance",
  "tempo",
  "threshold",
  "vo2Max",
  "anaerobic",
];

export function workoutOfRideTemplate(template: RideTemplate): Workout {
  return workoutSchema.parse({
    name: template.name,
    sport: "cycling",
    description: template.about,
    focus: rideCategories[template.category],
    steps: template.steps.map((step, index) => {
      const cues = (template.cues ?? [])
        .filter((cue) => cue.step === index)
        .map((cue) => ({ at: { type: "time", seconds: cue.at }, text: cue.text }));
      return {
        type: "step",
        duration: { type: "time", seconds: step.duration },
        target: { type: "power", unit: "ftp", level: { kind: "constant", value: step.intensity } },
        ...(cues.length > 0 ? { cues } : {}),
      };
    }),
  });
}

const library = (rideLibrary as RideTemplate[]).map((template) => {
  const workout = workoutOfRideTemplate(template);
  const { sortName, searchText, ...summary } = summaryOf(workout);
  return {
    id: slugOf(workout.name),
    summary,
    sortName,
    searchText,
    workout,
  };
});

export function builtinWorkout(id: string): BuiltinWorkout | undefined {
  const found = library.find((entry) => entry.id === id);
  return found && { id: found.id, ...found.summary, workout: found.workout };
}

export type BuiltinFilters = {
  query?: string | undefined;
  sport?: string | undefined;
  focus?: string | undefined;
  minSeconds?: number | undefined;
  maxSeconds?: number | undefined;
  sort: "library" | "name" | "duration";
};

export function builtinWorkouts(filters: BuiltinFilters): BuiltinWorkoutSummary[] {
  const terms = searchTerms(filters.query);
  const compareIds = (a: { id: string }, b: { id: string }) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const matching = library.filter(
    (entry) =>
      terms.every((term) => entry.searchText.includes(term)) &&
      (filters.sport === undefined || entry.summary.sport === filters.sport) &&
      (filters.focus === undefined || entry.summary.focus === filters.focus) &&
      (filters.minSeconds === undefined || entry.summary.totals.seconds >= filters.minSeconds) &&
      (filters.maxSeconds === undefined || entry.summary.totals.seconds <= filters.maxSeconds),
  );
  const sorted =
    filters.sort === "name"
      ? matching.toSorted(
          (a, b) =>
            (a.sortName < b.sortName ? -1 : a.sortName > b.sortName ? 1 : 0) || compareIds(a, b),
        )
      : filters.sort === "duration"
        ? matching.toSorted(
            (a, b) => a.summary.totals.seconds - b.summary.totals.seconds || compareIds(a, b),
          )
        : matching;
  return sorted.map((entry) => ({ id: entry.id, ...entry.summary }));
}
