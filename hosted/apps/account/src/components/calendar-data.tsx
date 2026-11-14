import type { Sport } from "@trainstack/workout";
import { profileOn } from "@trainstack/zones";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { api, queryClient } from "../api";
import { analysisRefreshMs } from "../lib/analysis";
import { type CalendarRange, type Period, rangeKey } from "../lib/calendar";
import { createCalendarWrites, plannedKey } from "../lib/calendar-writes";
import { datedChanges } from "../lib/settings";
import { referenceFor } from "../lib/workout-profile";
import { useSettingsHistory } from "./settings-data";

export const calendarWrites = createCalendarWrites({ queryClient, api });

export function useWritesVersion() {
  return useSyncExternalStore(calendarWrites.subscribe, calendarWrites.version, () => 0);
}

export function useCalendar(period: Pick<Period, "from" | "through">) {
  const query = useQuery({
    queryKey: rangeKey(period.from, period.through),
    queryFn: () => api.calendar.range({ from: period.from, through: period.through }),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => analysisRefreshMs((query.state.data?.analysesDue ?? 0) > 0),
    placeholderData: (previous) => previous,
  });
  const version = useWritesVersion();
  const shown = useMemo(
    () => (query.data ? calendarWrites.view(query.data) : undefined),
    [query.data, version],
  );
  return { query, range: shown };
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
    refetchInterval: (query) => {
      const held = query.state.data;
      return analysisRefreshMs(
        held?.compliance?.pending === true || (held?.pairing != null && held.compliance === null),
      );
    },
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
