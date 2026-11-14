import type { Activity } from "@trainstack/contract";

import { byWeek } from "./dates.ts";
import { localDay } from "./settings.ts";

type Listed = Pick<
  Activity,
  "localDay" | "startedAt" | "createdAt" | "statistics" | "analyzedAt" | "analysisError" | "file"
>;

export const dayOfActivity = (activity: Pick<Activity, "localDay" | "startedAt" | "createdAt">) =>
  activity.localDay ?? localDay(activity.startedAt ?? activity.createdAt);

export interface WeekTotals {
  readonly seconds: number;
  readonly metres: number;
  readonly load: number;
  readonly scored: number;
  readonly pending: number;
}

export function weekTotals(activities: readonly Listed[]): WeekTotals {
  let seconds = 0;
  let metres = 0;
  let load = 0;
  let scored = 0;
  let pending = 0;
  for (const { statistics, analyzedAt, analysisError, file } of activities) {
    seconds += statistics.timer_s ?? statistics.elapsed_s ?? 0;
    metres += statistics.distance_m ?? 0;
    if (statistics.load_tss !== undefined) {
      load += statistics.load_tss;
      scored += 1;
    } else if (analyzedAt === null && analysisError === null && file !== null) {
      pending += 1;
    }
  }
  return { seconds, metres, load, scored, pending };
}

export function activityWeeks<Item extends Listed>(activities: readonly Item[], hasMore: boolean) {
  const weeks = byWeek(activities, dayOfActivity);
  return weeks.map((week, index) => ({
    ...week,
    totals: weekTotals(week.items),
    complete: !hasMore || index < weeks.length - 1,
  }));
}
