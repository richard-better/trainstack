import type {
  CheckInItem,
  ReadinessCheckIn,
  ReadinessInput,
  ReadinessPlanned,
} from "../src/index.ts";

const millisecondsPerDay = 86_400_000;

export const shift = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * millisecondsPerDay).toISOString().slice(0, 10);

export const today = "2026-11-14";

export const week = [60, 0, 80, 50, 0, 120, 70];

export function trainedFor(
  days: number,
  through: string,
  stressOf: (back: number) => number = (back) => week[back % 7]!,
) {
  const stress = new Map<string, number>();
  for (let back = days; back >= 1; back--) {
    const value = stressOf(back);
    if (value > 0) stress.set(shift(through, -back + 1), value);
  }
  return stress;
}

type Ratings = Partial<Record<CheckInItem, number | null>>;

export const checkIn = (
  day: string,
  ratings: Ratings = {},
  extra: Partial<Pick<ReadinessCheckIn, "illness" | "injury">> = {},
): ReadinessCheckIn => ({
  day,
  ratings: { sleep: 3, energy: 3, soreness: 3, stress: 3, mood: 3, ...ratings },
  illness: extra.illness ?? null,
  injury: extra.injury ?? null,
});

export function checkedInFor(
  days: number,
  before: string,
  ratingsOf: (back: number) => Ratings = () => ({}),
) {
  const checkIns: ReadinessCheckIn[] = [];
  for (let back = days; back >= 1; back--) {
    checkIns.push(checkIn(shift(before, -back), ratingsOf(back)));
  }
  return checkIns;
}

export const workout = (
  id: string,
  seconds: number | null,
  load: number | null,
  state: ReadinessPlanned["state"] = "planned",
): ReadinessPlanned => ({ id, kind: "workout", state, seconds, load });

export const keySession = workout("key", 3600, 90);
export const enduranceRide = workout("endurance", 3600, 60);
export const recoverySpin = workout("recovery", 2700, 25);

export function athlete({
  stress = new Map(),
  checkIns = [],
  planned = [],
  day = today,
}: {
  stress?: Map<string, number>;
  checkIns?: ReadinessCheckIn[];
  planned?: ReadinessPlanned[];
  day?: string;
}): ReadinessInput {
  return { stress, checkIns, planned: new Map([[day, planned]]) };
}
