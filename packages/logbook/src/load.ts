export const frielTssPerHour = [0, 20, 30, 40, 50, 60, 70, 80, 100, 120, 140] as const;

export function tssPerHour(rpe: number) {
  const clamped = Math.min(10, Math.max(0, rpe));
  const below = Math.floor(clamped);
  const above = Math.ceil(clamped);
  const fraction = clamped - below;
  return frielTssPerHour[below]! * (1 - fraction) + frielTssPerHour[above]! * fraction;
}

export type SessionLoad = {
  sessionRpeLoad: number;
  stressScore: number;
};

export function sessionLoad(rpe: number | null, durationSeconds: number): SessionLoad | null {
  if (rpe === null || durationSeconds <= 0) return null;
  return {
    sessionRpeLoad: rpe * (durationSeconds / 60),
    stressScore: tssPerHour(rpe) * (durationSeconds / 3600),
  };
}
