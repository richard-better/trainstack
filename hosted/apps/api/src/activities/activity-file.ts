import type { ActivityStatisticName } from "@trainstack/contract";
import {
  ActivityFileError,
  summarizeActivityFile,
  type ActivityFileErrorCode,
  type ActivityLap,
  type Sport,
  type SubSport,
} from "@trainstack/activity-file";
import type { FitTotals } from "@trainstack/fit";

import type { ActivitySummaryError } from "../db/schema";
import { SummaryError, type FileSummary, type SummaryEvent } from "./file-summary";

const summaryErrorOf: Record<ActivityFileErrorCode, ActivitySummaryError> = {
  truncated: "truncated",
  unrecognizedFormat: "corrupt",
  badChecksum: "corrupt",
  malformed: "corrupt",
  noActivity: "no_activity",
  tooLarge: "too_large",
};

const statisticOf: Record<ActivityStatisticName, keyof FitTotals> = {
  elapsed_s: "elapsedSeconds",
  timer_s: "timerSeconds",
  distance_m: "distanceMetres",
  calories_kcal: "calories",
  average_speed_mps: "averageSpeedMetresPerSecond",
  max_speed_mps: "maxSpeedMetresPerSecond",
  average_heart_rate_bpm: "averageHeartRate",
  max_heart_rate_bpm: "maxHeartRate",
  average_cadence_rpm: "averageCadence",
  max_cadence_rpm: "maxCadence",
  average_power_w: "averagePower",
  max_power_w: "maxPower",
  ascent_m: "totalAscentMetres",
  descent_m: "totalDescentMetres",
};

type Totals = Partial<Record<keyof FitTotals, number | undefined>>;

function statistics(totals: Totals) {
  const named: Partial<Record<ActivityStatisticName, number>> = {};
  for (const [name, field] of Object.entries(statisticOf) as [
    ActivityStatisticName,
    keyof FitTotals,
  ][]) {
    const value = totals[field];
    if (value !== undefined && Number.isFinite(value)) named[name] = value;
  }
  return named;
}

const indoorCyclingSubSports = new Set<SubSport>(["indoorCycling", "virtualActivity", "spin"]);

const snakeCase = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

export function sportOf(sport: Sport | undefined, subSport: SubSport | undefined) {
  if (typeof sport !== "string" || sport === "generic") return undefined;
  if (sport === "cycling" && subSport !== undefined && indoorCyclingSubSports.has(subSport)) {
    return "indoor_cycling";
  }
  if (sport === "training" && subSport === "strengthTraining") return "strength";
  return snakeCase(sport);
}

const FIT_EPOCH = Date.UTC(1989, 11, 31);

const knownTime = (time: Date | undefined) =>
  time !== undefined && time.getTime() > FIT_EPOCH ? time : undefined;

function lapEvents(laps: readonly ActivityLap[]): SummaryEvent[] {
  return laps.flatMap((lap) => {
    const startedAt = knownTime(lap.startTime);
    if (!startedAt) return [];
    return [
      {
        type: "lap",
        startedAt,
        endedAt: knownTime(lap.endTime) ?? null,
        data: {
          ...statistics(lap),
          ...(typeof lap.trigger === "string" ? { trigger: snakeCase(lap.trigger) } : {}),
        },
      },
    ];
  });
}

export function summaryOfFile(bytes: Uint8Array): FileSummary {
  try {
    const activity = summarizeActivityFile(bytes);
    const { summary } = activity;
    return {
      startedAt: knownTime(summary.startTime),
      sport: sportOf(summary.sport, summary.subSport),
      name: activity.name?.trim() || undefined,
      statistics: statistics(summary),
      events: lapEvents(activity.laps).sort(
        (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
      ),
    };
  } catch (error) {
    if (error instanceof ActivityFileError) throw new SummaryError(summaryErrorOf[error.code]);
    throw error;
  }
}
