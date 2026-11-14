export type PairActivity = {
  id: string;
  sport: string | null;
  seconds: number | null;
  load: number | null;
  startedAt: number | null;
};

export type PairPlanned = {
  id: string;
  position: number;
  isWorkout: boolean;
  skipped: boolean;
  sport: string | null;
  seconds: number | null;
  load: number | null;
};

export type PairChoice = {
  plannedId: string;
  activityId: string;
  paired: boolean;
  updatedAt: number;
};

export type Pair = { plannedId: string; activityId: string; by: "athlete" | "auto" };

export const pairableSports = ["cycling", "running", "swimming"];

const missingRatio = Math.log(2);

const logRatio = (done: number | null, planned: number | null) =>
  done !== null && planned !== null && done > 0 && planned > 0
    ? Math.abs(Math.log(done / planned))
    : missingRatio;

export const closeness = (planned: PairPlanned, done: PairActivity) =>
  logRatio(done.seconds, planned.seconds) + logRatio(done.load, planned.load);

const isSameSport = (planned: PairPlanned, done: PairActivity) =>
  planned.sport !== null && pairableSports.includes(planned.sport) && done.sport === planned.sport;

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function pairDay(
  planned: readonly PairPlanned[],
  activities: readonly PairActivity[],
  choices: readonly PairChoice[],
): Pair[] {
  const plannedById = new Map(planned.map((entry) => [entry.id, entry]));
  const activityById = new Map(activities.map((entry) => [entry.id, entry]));
  const pairedPlanned = new Set<string>();
  const pairedActivities = new Set<string>();
  const pairs: Pair[] = [];
  const pair = (plannedId: string, activityId: string, by: Pair["by"]) => {
    pairs.push({ plannedId, activityId, by });
    pairedPlanned.add(plannedId);
    pairedActivities.add(activityId);
  };
  const chosen = choices
    .filter((choice) => choice.paired)
    .toSorted(
      (a, b) =>
        b.updatedAt - a.updatedAt ||
        byText(a.plannedId, b.plannedId) ||
        byText(a.activityId, b.activityId),
    );
  for (const choice of chosen) {
    if (!plannedById.get(choice.plannedId)?.isWorkout) continue;
    if (!activityById.has(choice.activityId)) continue;
    if (pairedPlanned.has(choice.plannedId) || pairedActivities.has(choice.activityId)) continue;
    pair(choice.plannedId, choice.activityId, "athlete");
  }
  const apart = new Set(
    choices
      .filter((choice) => !choice.paired)
      .map((choice) => `${choice.plannedId} ${choice.activityId}`),
  );
  const candidates = planned
    .filter((entry) => entry.isWorkout && !entry.skipped && !pairedPlanned.has(entry.id))
    .flatMap((entry) =>
      activities
        .filter(
          (done) =>
            !pairedActivities.has(done.id) &&
            isSameSport(entry, done) &&
            !apart.has(`${entry.id} ${done.id}`),
        )
        .map((done) => ({ planned: entry, done, cost: closeness(entry, done) })),
    )
    .toSorted(
      (a, b) =>
        a.cost - b.cost ||
        a.planned.position - b.planned.position ||
        byText(a.planned.id, b.planned.id) ||
        (a.done.startedAt ?? Infinity) - (b.done.startedAt ?? Infinity) ||
        byText(a.done.id, b.done.id),
    );
  for (const { planned: entry, done } of candidates) {
    if (pairedPlanned.has(entry.id) || pairedActivities.has(done.id)) continue;
    pair(entry.id, done.id, "auto");
  }
  return pairs;
}
