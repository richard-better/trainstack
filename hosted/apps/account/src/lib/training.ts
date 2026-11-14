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

export const loadRangeKeys = ["6w", "3m", "6m", "1y", "3y"] as const;
export type LoadRangeKey = (typeof loadRangeKeys)[number];

const rangeDays: Record<LoadRangeKey, number> = {
  "6w": 42,
  "3m": 91,
  "6m": 182,
  "1y": 365,
  "3y": 3 * 365,
};

const rangeLabels: Record<LoadRangeKey, string> = {
  "6w": "6 weeks",
  "3m": "3 months",
  "6m": "6 months",
  "1y": "1 year",
  "3y": "3 years",
};

export const loadRange = (key: LoadRangeKey, today: string) => ({
  key,
  label: rangeLabels[key],
  from: shiftDay(today, -(rangeDays[key] - 1)),
  through: today,
});

export const loadQueryKey = (from: string, through: string) =>
  ["training", "load", from, through] as const;

export interface FormZone {
  readonly key: "very_fresh" | "fresh" | "neutral" | "productive" | "overreaching";
  readonly label: string;
  readonly meaning: string;
  readonly from: number;
  readonly to: number;
}

export const formZones: readonly FormZone[] = [
  {
    key: "very_fresh",
    label: "Very fresh",
    meaning: "rested, and fitness is fading",
    from: 20,
    to: Infinity,
  },
  {
    key: "fresh",
    label: "Fresh",
    meaning: "rested and ready for a hard day or a race",
    from: 5,
    to: 20,
  },
  { key: "neutral", label: "Neutral", meaning: "holding steady", from: -10, to: 5 },
  {
    key: "productive",
    label: "Productive",
    meaning: "training is building fitness",
    from: -30,
    to: -10,
  },
  {
    key: "overreaching",
    label: "Overreaching",
    meaning: "fatigue is high, so plan some rest",
    from: -Infinity,
    to: -30,
  },
];

export const formZoneOf = (form: number) =>
  formZones.find((zone) => form >= zone.from && form < zone.to) ?? formZones[2]!;

export const signed = (value: number) => {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
};

export interface LoadDay {
  readonly day: string;
  readonly stress: number;
  readonly fitness: number;
  readonly fatigue: number;
  readonly form: number;
  readonly activities: readonly { id: string; stress: number; source: string }[];
}

export const RAMP_DAYS = 7;
export const FITNESS_BUILD_DAYS = 42;

export function loadSummary(days: readonly LoadDay[], today: string) {
  const now = days.find((entry) => entry.day === today) ?? days.at(-1);
  if (!now) return null;
  const weekAgo = days.find((entry) => entry.day === shiftDay(now.day, -RAMP_DAYS));
  return {
    day: now,
    zone: formZoneOf(now.form),
    ramp: weekAgo ? now.fitness - weekAgo.fitness : null,
  };
}

export function loadHistory(days: readonly LoadDay[]) {
  const firstLoaded = days.find((entry) => entry.stress > 0)?.day ?? null;
  const loadedDays = days.filter((entry) => entry.stress > 0).length;
  const anyFitness = days.some((entry) => entry.fitness > 0.5);
  return { firstLoaded, loadedDays, anyFitness };
}
