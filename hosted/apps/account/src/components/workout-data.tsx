import type { StoredWorkout, WorkoutList, WorkoutSort } from "@trainstack/contract";
import type { Focus, Sport } from "@trainstack/workout";
import { profileOn } from "@trainstack/zones";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import { api, queryClient } from "../api";
import {
  type DurationBucket,
  durationFilter,
  emptyLibrary,
  isBehind,
  type Library,
  forgetIn,
  queueListWrite,
  refreshLibrary,
  rememberIn,
} from "../lib/library";
import { datedChanges, localDay } from "../lib/settings";
import { type Reference, referenceFor } from "../lib/workout-profile";
import { useSettingsHistory } from "./settings-data";

export const libraryKey = ["workouts", "library"] as const;
export const searchKey = ["workouts", "search"] as const;
export const builtinsKey = ["builtin-workouts"] as const;
export const listsKey = ["workout-lists"] as const;

export const WORKOUTS_PER_PAGE = 30;

export function useLibrary() {
  return useQuery({
    queryKey: libraryKey,
    queryFn: () =>
      refreshLibrary(api, queryClient.getQueryData<Library>(libraryKey) ?? emptyLibrary),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
}

export async function rememberWorkout(workout: StoredWorkout) {
  void queryClient.invalidateQueries({ queryKey: searchKey });
  await rememberIn(queryClient, libraryKey, workout);
}

export async function forgetWorkout(id: string) {
  void queryClient.invalidateQueries({ queryKey: searchKey });
  queryClient.setQueryData<{ lists: WorkoutList[] }>(listsKey, (data) =>
    data
      ? {
          lists: data.lists.map((list) => ({
            ...list,
            workoutIds: list.workoutIds.filter((workoutId) => workoutId !== id),
          })),
        }
      : data,
  );
  await forgetIn(queryClient, libraryKey, id);
}

export type Filters = {
  readonly query?: string | undefined;
  readonly sport?: Sport | undefined;
  readonly focus?: Focus | undefined;
  readonly length?: DurationBucket | undefined;
};

function filterInput({ query, sport, focus, length }: Filters) {
  return {
    ...(query ? { query } : {}),
    ...(sport ? { sport } : {}),
    ...(focus ? { focus } : {}),
    ...durationFilter(length),
  };
}

export function useWorkoutSearch(filters: Filters, sort: WorkoutSort) {
  const library = useLibrary();
  const search = useInfiniteQuery({
    queryKey: [...searchKey, filters, sort],
    queryFn: ({ pageParam }) =>
      api.workouts.list({
        ...filterInput(filters),
        sort,
        limit: WORKOUTS_PER_PAGE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchOnWindowFocus: true,
  });
  const summaries = useMemo(
    () => search.data?.pages.flatMap((page) => page.workouts) ?? [],
    [search.data],
  );
  const behind = library.data !== undefined && isBehind(library.data, summaries);
  const caughtUpFor = useRef<readonly unknown[] | null>(null);
  const { refetch } = library;
  useEffect(() => {
    if (!behind || caughtUpFor.current === summaries) return;
    caughtUpFor.current = summaries;
    void refetch();
  }, [behind, summaries, refetch]);
  return { search, summaries, library };
}

export function useBuiltins(filters: Filters, sort: "library" | "name" | "duration") {
  return useQuery({
    queryKey: [...builtinsKey, "list", filters, sort],
    queryFn: () => api.builtinWorkouts.list({ ...filterInput(filters), sort }),
    staleTime: Infinity,
  });
}

export function useBuiltin(id: string) {
  return useQuery({
    queryKey: [...builtinsKey, id],
    queryFn: () => api.builtinWorkouts.get({ id }),
    staleTime: Infinity,
  });
}

export function useLists() {
  return useQuery({
    queryKey: listsKey,
    queryFn: () => api.workoutLists.list({}),
    refetchOnWindowFocus: true,
  });
}

export function rememberList(list: WorkoutList) {
  queryClient.setQueryData<{ lists: WorkoutList[] }>(listsKey, (data) => {
    const lists = data?.lists ?? [];
    const known = lists.some((held) => held.id === list.id);
    return {
      lists: known ? lists.map((held) => (held.id === list.id ? list : held)) : [...lists, list],
    };
  });
}

export const writeList = (
  id: string,
  optimistic: (list: WorkoutList) => WorkoutList,
  send: () => Promise<WorkoutList>,
) => queueListWrite(queryClient, listsKey, id, optimistic, send);

export const latestList = (id: string) =>
  queryClient
    .getQueryData<{ lists: WorkoutList[] }>(listsKey)
    ?.lists.find((list) => list.id === id);

export function forgetList(id: string) {
  queryClient.setQueryData<{ lists: WorkoutList[] }>(listsKey, (data) =>
    data ? { lists: data.lists.filter((list) => list.id !== id) } : data,
  );
}

export function useReference(sport: Sport): { reference: Reference; loaded: boolean } {
  const history = useSettingsHistory();
  const reference = useMemo(() => {
    const profile = history.data
      ? profileOn(datedChanges(history.data.entries), localDay(new Date()))
      : null;
    return referenceFor(profile, sport);
  }, [history.data, sport]);
  return { reference, loaded: history.data !== undefined };
}
