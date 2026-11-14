import { isDefinedError, safe } from "@orpc/client";
import type { StoredWorkout } from "@trainstack/contract";
import type { Workout } from "@trainstack/workout";

import type { ApiClient } from "./client.ts";

export type SaveOutcome =
  | { readonly kind: "saved"; readonly stored: StoredWorkout }
  | { readonly kind: "changed"; readonly stored: StoredWorkout }
  | { readonly kind: "overruled"; readonly stored: StoredWorkout }
  | { readonly kind: "deleted" }
  | { readonly kind: "refused"; readonly reason: string };

export type SaveRequest = {
  readonly id: string;
  readonly workout: Workout;
  readonly base: Date | null;
  readonly overwrite: boolean;
  readonly now?: Date;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, inner]) => [key, canonical(inner)]),
  );
}

export const sameWorkout = (a: Workout, b: Workout) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export async function saveWorkout(api: ApiClient, request: SaveRequest): Promise<SaveOutcome> {
  if (request.base !== null && !request.overwrite) {
    const [error, current] = await safe(api.workouts.get({ id: request.id }));
    if (error) {
      if (
        isDefinedError(error) &&
        (error.code === "WORKOUT_DELETED" || error.code === "NOT_FOUND")
      ) {
        return { kind: "deleted" };
      }
      throw error;
    }
    if (
      current.updatedAt.getTime() > request.base.getTime() &&
      !sameWorkout(current.workout, request.workout)
    ) {
      return { kind: "changed", stored: current };
    }
  }
  const updatedAt = request.now ?? new Date();
  const [error, stored] = await safe(
    api.workouts.put({ id: request.id, workout: request.workout, updatedAt }),
  );
  if (error) {
    if (!isDefinedError(error)) throw error;
    switch (error.code) {
      case "WORKOUT_DELETED":
        return { kind: "deleted" };
      case "EDITED_IN_THE_FUTURE":
        return {
          kind: "refused",
          reason:
            "Your device's clock is ahead of Trainstack's. Set it to the right time and save again.",
        };
      case "INVALID_WORKOUT":
        return { kind: "refused", reason: error.data.reason };
      case "WORKOUT_TOO_LARGE":
        return {
          kind: "refused",
          reason: "This workout is too large to save. Remove some steps or cues.",
        };
      default:
        throw error;
    }
  }
  const won =
    stored.updatedAt.getTime() === updatedAt.getTime() &&
    sameWorkout(stored.workout, request.workout);
  return won ? { kind: "saved", stored } : { kind: "overruled", stored };
}
