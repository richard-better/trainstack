import type { Step } from "@trainstack/workout";

export type PlannedLength =
  | { kind: "time"; seconds: number }
  | { kind: "distance"; meters: number }
  | null;

export function plannedLength(step: Step): PlannedLength {
  const duration = step.duration as { type: string; seconds?: number; meters?: number };
  if (duration.type === "time" && duration.seconds !== undefined) {
    return { kind: "time", seconds: duration.seconds };
  }
  if (duration.type === "distance" && duration.meters !== undefined) {
    return { kind: "distance", meters: duration.meters };
  }
  return null;
}
