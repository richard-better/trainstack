import { baselineOf, type BaselineWindow } from "./baseline.ts";
import { daysBetween } from "./day.ts";
import { type CheckInItem, checkInItems, type ReadinessCheckIn } from "./inputs.ts";

export const checkInBaseline: BaselineWindow = { days: 28, minimum: 7 };
export const scaleNormal = 3;
export const worseBy = 1;
export const muchWorseBy = 2;
export const betterBy = 1;

export type Effect = "lowers" | "steady" | "raises";

export interface CheckInReason {
  readonly kind: "check_in";
  readonly item: CheckInItem;
  readonly rating: number;
  readonly usual: number;
  readonly against: "own" | "scale";
  readonly difference: number;
  readonly effect: Effect;
  readonly weight: number;
}

const isBaselineDay = (checkIn: ReadinessCheckIn, day: string) => {
  const before = daysBetween(checkIn.day, day);
  return before >= 1 && before <= checkInBaseline.days && checkIn.illness === null;
};

export function baselineCheckIns(
  checkIns: readonly ReadinessCheckIn[],
  day: string,
  items: readonly CheckInItem[],
) {
  const history = checkIns.filter((checkIn) => isBaselineDay(checkIn, day));
  const rated = (item: CheckInItem) =>
    history.filter((checkIn) => checkIn.ratings[item] !== null).length;
  if (items.length === 0) {
    return history.filter((checkIn) => checkInItems.some((item) => checkIn.ratings[item] !== null))
      .length;
  }
  return Math.min(...items.map(rated));
}

export function checkInReasons(
  today: ReadinessCheckIn,
  checkIns: readonly ReadinessCheckIn[],
): CheckInReason[] {
  const history = checkIns.filter((checkIn) => isBaselineDay(checkIn, today.day));
  return checkInItems.flatMap((item) => {
    const rating = today.ratings[item];
    if (rating === null) return [];
    const baseline = baselineOf(
      history.flatMap((checkIn) => {
        const value = checkIn.ratings[item];
        return value === null ? [] : [{ day: checkIn.day, value }];
      }),
      today.day,
      checkInBaseline,
    );
    const usual = baseline ? Math.round(baseline.mean) : scaleNormal;
    const difference = rating - usual;
    const weight = difference <= -muchWorseBy ? 2 : difference <= -worseBy ? 1 : 0;
    const effect: Effect = weight > 0 ? "lowers" : difference >= betterBy ? "raises" : "steady";
    return [
      {
        kind: "check_in",
        item,
        rating,
        usual,
        against: baseline ? "own" : "scale",
        difference,
        effect,
        weight,
      },
    ];
  });
}
