import type { ZoneMetric } from "./metrics.ts";

export type KnownSport = {
  metrics: readonly ZoneMetric[];
  paceDistanceMetres?: number;
};

export const knownSports: Record<string, KnownSport> = {
  cycling: { metrics: ["heart_rate", "power"] },
  running: { metrics: ["heart_rate", "power", "pace"], paceDistanceMetres: 1000 },
  swimming: { metrics: ["heart_rate", "pace"], paceDistanceMetres: 100 },
  rowing: { metrics: ["heart_rate", "power"] },
  strength: { metrics: ["heart_rate"] },
};

export const defaultMetrics: readonly ZoneMetric[] = ["heart_rate", "power"];

export const sportMetrics = (sport: string): readonly ZoneMetric[] =>
  (Object.hasOwn(knownSports, sport) ? knownSports[sport]?.metrics : undefined) ?? defaultMetrics;

export const paceDistanceMetres = (sport: string): number | undefined =>
  Object.hasOwn(knownSports, sport) ? knownSports[sport]?.paceDistanceMetres : undefined;

export function sportOrder(a: string, b: string) {
  const known = Object.keys(knownSports);
  const rank = (sport: string) => (known.includes(sport) ? known.indexOf(sport) : known.length);
  return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
}
