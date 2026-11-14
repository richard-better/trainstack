import { daysBetween } from "./day.ts";
import type { IllnessKind, InjuryTraining, ReadinessCheckIn } from "./inputs.ts";

export const recentIllnessDays = 7;

export type HealthReason<Area extends string = string> =
  | { readonly kind: "ill"; readonly illness: IllnessKind }
  | { readonly kind: "injured"; readonly area: Area; readonly training: InjuryTraining }
  | { readonly kind: "recently_ill"; readonly lastDay: string; readonly daysAgo: number };

export function healthReasons<Area extends string>(
  today: ReadinessCheckIn<Area> | null,
  checkIns: readonly ReadinessCheckIn<Area>[],
  day: string,
): HealthReason<Area>[] {
  const reasons: HealthReason<Area>[] = [];
  if (today?.illness) reasons.push({ kind: "ill", illness: today.illness.kind });
  if (today?.injury) {
    reasons.push({ kind: "injured", area: today.injury.area, training: today.injury.training });
  }
  if (!today?.illness) {
    const lastIll = checkIns
      .filter((checkIn) => {
        const before = daysBetween(checkIn.day, day);
        return checkIn.illness !== null && before >= 1 && before <= recentIllnessDays;
      })
      .map((checkIn) => checkIn.day)
      .sort()
      .at(-1);
    if (lastIll) {
      reasons.push({ kind: "recently_ill", lastDay: lastIll, daysAgo: daysBetween(lastIll, day) });
    }
  }
  return reasons;
}
