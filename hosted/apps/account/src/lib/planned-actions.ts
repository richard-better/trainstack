import type { CalendarActivity, PlannedContent, PlannedWorkout } from "@trainstack/contract";

import { sportName } from "./sports.ts";

export function pairingChoices(
  content: PlannedContent,
  activities: readonly CalendarActivity[],
  doneId: string | null,
) {
  if (content.kind !== "workout") return [];
  const family = sportName(content.workout.sport).family;
  return activities.filter(
    (activity) =>
      activity.id !== doneId && sportName(activity.sport, activity.indoor).family === family,
  );
}

export const canSkip = (item: PlannedWorkout) =>
  item.content.kind === "workout" && item.state !== "completed" && item.pairing === null;
