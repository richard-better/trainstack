import { totals, type Workout } from "@trainstack/workout";

export function searchable(text: string) {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").replaceAll("×", "x").toLowerCase();
}

export function slugOf(name: string) {
  return searchable(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function searchTerms(query: string | undefined) {
  return searchable(query ?? "")
    .split(/\s+/)
    .filter((term) => term.length > 0);
}

export function summaryOf(workout: Workout) {
  const tags = workout.tags ?? [];
  return {
    name: workout.name,
    sport: workout.sport,
    focus: workout.focus ?? null,
    description: workout.description ?? null,
    author: workout.author ?? null,
    tags,
    totals: totals(workout.steps),
    sortName: searchable(workout.name),
    searchText: searchable(
      [workout.name, workout.description ?? "", workout.author ?? "", ...tags].join("\n"),
    ),
  };
}

export type Summary = ReturnType<typeof summaryOf>;
