import type { Activity } from "@trainstack/contract";
import type { Sport } from "@trainstack/workout";
import { profileOn } from "@trainstack/zones";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { api, queryClient } from "../api";
import { analysisRefreshMs, anyAnalysisDue } from "../lib/analysis";
import { type CalendarRange, type Period, rangeKey } from "../lib/calendar";
import { createCalendarWrites, plannedKey } from "../lib/calendar-writes";
import { datedChanges } from "../lib/settings";
import { shiftDay } from "../lib/training";
import { referenceFor } from "../lib/workout-profile";
import { useSettingsHistory } from "./settings-data";

export const calendarWrites = createCalendarWrites({ queryClient, api });

export function useWritesVersion() {
  return useSyncExternalStore(calendarWrites.subscribe, calendarWrites.version, () => 0);
}

export function useCalendar(period: Pick<Period, "from" | "through">) {
  const routes = useActivitiesIn(period.from, period.through);
  const due = anyAnalysisDue(routes.data ?? []);
  const query = useQuery({
    queryKey: rangeKey(period.from, period.through),
    queryFn: () => api.calendar.range({ from: period.from, through: period.through }),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchInterval: analysisRefreshMs(due),
    placeholderData: (previous) => previous,
  });
  const version = useWritesVersion();
  const shown = useMemo(
    () => (query.data ? calendarWrites.view(query.data) : undefined),
    [query.data, version],
  );
  const activities = useMemo(
    () => new Map((routes.data ?? []).map((activity) => [activity.id, activity])),
    [routes.data],
  );
  return { query, range: shown, activities };
}

const PAGE = 200;
const MAX_PAGES = 3;

function useActivitiesIn(from: string, through: string) {
  return useQuery({
    queryKey: ["calendar-activities", from, through],
    queryFn: async () => {
      const startedAfter = new Date(`${shiftDay(from, -1)}T00:00:00Z`);
      const startedBefore = new Date(`${shiftDay(through, 2)}T00:00:00Z`);
      const found: Activity[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await api.activities.list({
          limit: PAGE,
          onePerWorkout: true,
          startedAfter,
          startedBefore,
          ...(cursor ? { cursor } : {}),
        });
        found.push(...result.activities);
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }
      return found;
    },
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => analysisRefreshMs(anyAnalysisDue(query.state.data ?? [])),
    placeholderData: (previous) => previous,
  });
}

export function usePlanned(id: string) {
  const seeded = useCallback(() => {
    for (const [, range] of queryClient.getQueriesData<CalendarRange>({ queryKey: ["calendar"] })) {
      const found = range?.days.flatMap((day) => day.planned).find((item) => item.id === id);
      if (found) return found;
    }
    return undefined;
  }, [id]);
  const query = useQuery({
    queryKey: plannedKey(id),
    queryFn: () => api.plannedWorkouts.get({ id }),
    initialData: seeded,
    initialDataUpdatedAt: 0,
    retry: (failures, error) =>
      !("status" in error && typeof error.status === "number" && error.status < 500) &&
      failures < 2,
  });
  return query;
}

export function useReferenceOn() {
  const history = useSettingsHistory();
  return useMemo(() => {
    const changes = history.data ? datedChanges(history.data.entries) : null;
    const cache = new Map<string, ReturnType<typeof referenceFor>>();
    return (day: string, sport: Sport) => {
      const key = `${day} ${sport}`;
      const known = cache.get(key);
      if (known) return known;
      const reference = referenceFor(changes ? profileOn(changes, day) : null, sport);
      cache.set(key, reference);
      return reference;
    };
  }, [history.data]);
}
