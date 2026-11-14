import {
  metricSettings,
  paceDistanceMetres,
  type Profile,
  type ZoneMetric,
  zonesOf,
} from "@trainstack/zones";

import type { FitAthlete, FitZone } from "./fit-read.ts";
import type { FitWriteOptions } from "./fit-write.ts";
import type { Sport } from "./model.ts";

export type AthleteThresholds = Pick<FitWriteOptions, "thresholdHeartRate" | "thresholdPace"> & {
  ftp?: number | undefined;
};

function zonesIn(profile: Profile, metric: ZoneMetric, sport: Sport): FitZone[] | undefined {
  const settings = metricSettings(profile, metric, sport);
  const set = settings && zonesOf(settings);
  if (!set) return undefined;
  if (metric !== "pace") return set.zones.map(({ start, end }) => ({ low: start, high: end }));
  const distance = paceDistanceMetres(sport);
  if (distance === undefined) return undefined;
  const speed = (seconds: number | null) => (seconds === null ? null : distance / seconds);
  return set.zones.map(({ start, end }) => ({ low: speed(start), high: speed(end) }));
}

function threshold(
  profile: Profile,
  metric: ZoneMetric,
  sport: Sport,
  name: string,
): number | undefined {
  const settings = metricSettings(profile, metric, sport);
  return (settings?.thresholds as Record<string, number | undefined> | undefined)?.[name];
}

export function athleteThresholds(profile: Profile, sport: Sport): AthleteThresholds {
  const pace = threshold(profile, "pace", sport, "threshold_pace");
  const distance = paceDistanceMetres(sport);
  return {
    ftp: threshold(profile, "power", sport, "ftp"),
    thresholdHeartRate: threshold(profile, "heart_rate", sport, "lactate_threshold_heart_rate"),
    thresholdPace: pace === undefined || distance === undefined ? undefined : distance / pace,
  };
}

export function fitAthlete(profile: Profile, sport: Sport, source: string): FitAthlete {
  return {
    maxHeartRate: threshold(profile, "heart_rate", sport, "max_heart_rate"),
    zones: {
      heartRate: zonesIn(profile, "heart_rate", sport),
      power: zonesIn(profile, "power", sport),
      speed: zonesIn(profile, "pace", sport),
      source,
    },
  };
}
