const DAY_MS = 86_400_000;

export const ALL_TIME_FROM = "2000-01-01";

export const shiftDay = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export const daysBetween = (from: string, through: string) =>
  Math.round((Date.parse(`${through}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export const bestsPeriodKeys = ["season", "six_weeks", "all"] as const;
export type BestsPeriodKey = (typeof bestsPeriodKeys)[number];

export interface BestsPeriod {
  readonly key: BestsPeriodKey;
  readonly label: string;
  readonly from: string;
  readonly description: string;
}

export function bestsPeriod(key: BestsPeriodKey, today: string): BestsPeriod {
  switch (key) {
    case "season":
      return {
        key,
        label: "This season",
        from: `${today.slice(0, 4)}-01-01`,
        description: `since 1 January ${today.slice(0, 4)}`,
      };
    case "six_weeks":
      return {
        key,
        label: "Last 6 weeks",
        from: shiftDay(today, -41),
        description: "the last 6 weeks",
      };
    case "all":
      return { key, label: "All time", from: ALL_TIME_FROM, description: "all time" };
  }
}

export const bestsQueryKey = (from: string, sport: string | null) =>
  ["training", "bests", from, sport] as const;
