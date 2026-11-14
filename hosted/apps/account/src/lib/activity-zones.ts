import type { DecodedActivity } from "@trainstack/activity-file";
import {
  type ActivityAnalysis,
  analyzeActivity,
  type ZoneShare,
  zoneSport,
} from "@trainstack/analysis";
import { paceDistanceMetres, type Profile, type ZoneMetric, type ZoneSet } from "@trainstack/zones";

import type { ChannelKey, Trace } from "./series.ts";

type Decoded = Pick<DecodedActivity, "summary" | "records" | "laps" | "events">;

export function analysisOf(
  activity: Decoded,
  activitySport: string | null,
  profile: Profile,
): ActivityAnalysis {
  const fromFile = zoneSport(activity.summary.sport, activity.summary.subSport);
  const sport = fromFile ?? activitySport ?? undefined;
  return analyzeActivity(
    {
      summary: {
        startTime: activity.summary.startTime,
        sport,
        subSport: fromFile === null ? undefined : activity.summary.subSport,
        elapsedSeconds:
          activity.summary.elapsedSeconds ?? activity.records.at(-1)?.elapsedSeconds ?? 0,
      },
      records: activity.records,
      laps: activity.laps,
      events: activity.events,
    },
    profile,
  );
}

const channelOf: Record<ZoneMetric, ChannelKey> = {
  power: "power",
  heart_rate: "heartRate",
  pace: "speed",
};

export const zoneOrder: readonly ZoneMetric[] = ["power", "heart_rate", "pace"];

export const recordedMetrics = (trace: Trace, sport: string | null) =>
  zoneOrder.filter(
    (metric) =>
      trace.channels.some((channel) => channel.key === channelOf[metric]) &&
      (metric !== "pace" || (sport !== null && paceDistanceMetres(sport) !== undefined)),
  );

const zoneStatistic = (metric: ZoneMetric, label: string) =>
  `time_in_${metric}_zone_${label.toLowerCase()}_s`;

export function storedShares(
  statistics: Readonly<Record<string, number>>,
  set: ZoneSet,
): ZoneShare[] {
  const seconds = set.zones.map((zone) => statistics[zoneStatistic(set.metric, zone.label)]);
  if (seconds.every((value) => value === undefined)) return [];
  const total = seconds.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (total <= 0) return [];
  return set.zones.map((zone, index) => ({
    zone,
    seconds: seconds[index] ?? 0,
    fraction: (seconds[index] ?? 0) / total,
  }));
}
