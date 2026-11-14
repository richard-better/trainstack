import { isDefinedError, safe } from "@orpc/client";
import type { StoredSession } from "@trainstack/contract";
import type { LoggedSession, LoggedSport, MassUnit } from "@trainstack/logbook";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { activitiesQueryKey, api, queryClient } from "../api";
import { unitKey } from "../lib/logbook";

export const logbookKey = ["logbook"] as const;
export const sessionKey = (id: string) => [...logbookKey, "session", id] as const;
export const exercisesKey = [...logbookKey, "exercises"] as const;
export const latestKey = (sport: LoggedSport, exerciseId?: string) =>
  [...logbookKey, "latest", sport, exerciseId ?? null] as const;

export function useExercises() {
  return useQuery({ queryKey: exercisesKey, queryFn: () => api.logbook.exercises({}) });
}

export function useLatest(sport: LoggedSport) {
  return useQuery({ queryKey: latestKey(sport), queryFn: () => api.logbook.latest({ sport }) });
}

export function useStoredSession(id: string | undefined) {
  return useQuery({
    queryKey: sessionKey(id ?? ""),
    queryFn: () => api.logbook.get({ id: id! }),
    enabled: id !== undefined,
    retry: false,
  });
}

export const latestWith = (exerciseId: string) =>
  queryClient.fetchQuery({
    queryKey: latestKey("strength", exerciseId),
    queryFn: () => api.logbook.latest({ sport: "strength", exerciseId }),
    staleTime: 60_000,
  });

function refreshAround() {
  void queryClient.invalidateQueries({ queryKey: activitiesQueryKey });
  void queryClient.invalidateQueries({ queryKey: ["activity"] });
  void queryClient.invalidateQueries({ queryKey: logbookKey });
  void queryClient.invalidateQueries({ queryKey: ["calendar"] });
  void queryClient.invalidateQueries({ queryKey: ["training"] });
}

export type SaveOutcome =
  | { kind: "saved"; stored: StoredSession }
  | { kind: "deleted" }
  | { kind: "refused"; reason: string };

export async function saveSession(
  id: string,
  session: LoggedSession,
  editedAt = new Date(),
): Promise<SaveOutcome> {
  const [error, stored] = await safe(api.logbook.put({ id, session, editedAt }));
  if (stored) {
    queryClient.setQueryData(sessionKey(id), stored);
    refreshAround();
    return { kind: "saved", stored };
  }
  if (isDefinedError(error)) {
    if (error.code === "SESSION_DELETED") return { kind: "deleted" };
    if (error.code === "UNKNOWN_EXERCISE") {
      return { kind: "refused", reason: "One of the exercises is no longer in your account." };
    }
    if (error.code === "EDITED_IN_THE_FUTURE") {
      return {
        kind: "refused",
        reason: "This device's clock is ahead. Set it right and save again.",
      };
    }
  }
  return {
    kind: "refused",
    reason: "The session did not save. Check your connection and try again.",
  };
}

export async function deleteSession(stored: Pick<StoredSession, "id">) {
  await api.logbook.delete({ id: stored.id });
  queryClient.removeQueries({ queryKey: sessionKey(stored.id) });
  refreshAround();
}

export function usePreferredUnit(): [MassUnit, (unit: MassUnit) => void] {
  const [unit, setUnit] = useState<MassUnit>(() => {
    try {
      return localStorage.getItem(unitKey) === "lb" ? "lb" : "kg";
    } catch {
      return "kg";
    }
  });
  return [
    unit,
    (next) => {
      setUnit(next);
      try {
        localStorage.setItem(unitKey, next);
      } catch {
        return;
      }
    },
  ];
}
