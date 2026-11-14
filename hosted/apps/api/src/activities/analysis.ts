import {
  ActivityFileError,
  streamActivityFile,
  type ActivityFileColumns,
} from "@trainstack/activity-file";
import {
  type ActivityAnalysis,
  analysisColumnLimits,
  analyzeActivity,
  statisticsOf,
} from "@trainstack/analysis";
import {
  type DatedChange,
  metricSettings,
  missingThresholds,
  type Profile,
  profileOn,
  type ThresholdName,
  type ZoneMetric,
} from "@trainstack/zones";
import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";

import type { Database } from "../db";
import {
  activity,
  activityAnalysis,
  activityEvent,
  activityStatistic,
  type ActivityAnalysisError,
} from "../db/schema";
import { settingsHistoryOf } from "../settings/router";
import { lapEventOrder } from "./activity-file";
import { isAnalysisStatistic } from "./analysis-statistics";
import { fileKey, sha256Hex } from "./files";
import { MAX_EVENTS_PER_ACTIVITY } from "./summary";

export const ANALYSIS_VERSION = 1;
export const MAX_ANALYSIS_ATTEMPTS = 3;
export const ANALYSIS_CHECKS_PER_SCHEDULED_RUN = 200;
export const ANALYSES_PER_SCHEDULED_RUN = 20;
export const ANALYSIS_BYTES_PER_SCHEDULED_RUN = 48 * 1024 * 1024;

export type AnalysisTarget = {
  userId: string;
  id: string;
  version: number;
  generation: number;
  attempts: number;
  profile: string | null;
  error: ActivityAnalysisError | null;
  localDay: string | null;
  fileSize: number | null;
};

type Outcome =
  | {
      analysis: ActivityAnalysis;
      statistics: Record<string, number>;
      laps: { sequence: number; data: Record<string, number | null> }[];
      missingThresholds: string[];
    }
  | { error: ActivityAnalysisError };

const hasValue = (values: Float64Array) => values.some((value) => !Number.isNaN(value));

const heartRateStressThresholds: ThresholdName[] = [
  "resting_heart_rate",
  "max_heart_rate",
  "lactate_threshold_heart_rate",
];

function missingFor(file: ActivityFileColumns, analysis: ActivityAnalysis, profile: Profile) {
  const { sport } = analysis;
  const { records } = file;
  const missing = new Set<string>();
  const withData: ZoneMetric[] = [];
  if (hasValue(records.heartRate)) withData.push("heart_rate");
  if (hasValue(records.power)) withData.push("power");
  if (sport !== null && hasValue(records.speedMetresPerSecond)) withData.push("pace");
  for (const metric of withData) {
    const settings = metricSettings(profile, metric, sport);
    if (!settings) continue;
    for (const threshold of missingThresholds(settings)) missing.add(threshold);
  }
  if (withData.includes("power") && analysis.powerStressScore === null) {
    if (metricSettings(profile, "power", sport)?.thresholds.ftp === undefined) missing.add("ftp");
  }
  if (sport === "running" && analysis.averageGradeAdjustedSpeed !== null) {
    if (metricSettings(profile, "pace", sport)?.thresholds.threshold_pace === undefined) {
      missing.add("threshold_pace");
    }
  }
  if (withData.includes("heart_rate") && analysis.heartRateStressScore === null) {
    const thresholds = metricSettings(profile, "heart_rate", sport)?.thresholds ?? {};
    for (const threshold of heartRateStressThresholds) {
      if (thresholds[threshold] === undefined) missing.add(threshold);
    }
  }
  return [...missing].sort();
}

function lapData(file: ActivityFileColumns, analysis: ActivityAnalysis) {
  const analysedLap = new Map<number, number>();
  file.laps.forEach((lap, index) => {
    if (lap.startTime !== undefined && Number.isFinite(lap.startTime.getTime())) {
      analysedLap.set(index, analysedLap.size);
    }
  });
  return lapEventOrder(file.laps)
    .slice(0, MAX_EVENTS_PER_ACTIVITY)
    .flatMap((lapIndex, sequence) => {
      const lap = analysis.laps[analysedLap.get(lapIndex) ?? -1];
      if (!lap) return [];
      return [
        {
          sequence,
          data: {
            normalized_power_w: lap.normalizedPowerWatts,
            work_kj: lap.workKilojoules,
            average_grade_adjusted_speed_mps: lap.averageGradeAdjustedSpeed,
          },
        },
      ];
    });
}

export function analysisOfFile(bytes: Uint8Array, profile: Profile): Outcome {
  let file: ActivityFileColumns;
  try {
    file = streamActivityFile(bytes, analysisColumnLimits);
  } catch (error) {
    if (!(error instanceof ActivityFileError)) throw error;
    return { error: error.code === "tooLarge" ? "too_large" : "failed" };
  }
  const analysis = analyzeActivity(file, profile);
  return {
    analysis,
    statistics: statisticsOf(analysis),
    laps: lapData(file, analysis),
    missingThresholds: missingFor(file, analysis, profile),
  };
}

const zonesOf = ({ defaults, sports }: Profile) =>
  sha256Hex(new TextEncoder().encode(JSON.stringify({ defaults, sports })));

const ours = (target: AnalysisTarget, attempts: number) =>
  and(
    eq(activityAnalysis.userId, target.userId),
    eq(activityAnalysis.activityId, target.id),
    eq(activityAnalysis.generation, target.generation),
    eq(activityAnalysis.attempts, attempts),
  );

async function store(
  db: Database,
  target: AnalysisTarget,
  attempts: number,
  fingerprint: string,
  outcome: Outcome,
) {
  const { userId, id } = target;
  const stillOurs = sql`EXISTS (SELECT 1 FROM ${activityAnalysis} WHERE user_id = ${userId} AND activity_id = ${id} AND generation = ${target.generation} AND attempts = ${attempts})`;
  const analysed = "analysis" in outcome ? outcome : undefined;
  await db.batch([
    db.run(sql`
      DELETE FROM ${activityStatistic}
      WHERE user_id = ${userId} AND activity_id = ${id} AND ${isAnalysisStatistic(sql`name`)} AND ${stillOurs}
    `),
    db.run(sql`
      INSERT INTO ${activityStatistic} (user_id, activity_id, name, value)
      SELECT ${userId}, ${id}, key, value FROM json_each(${JSON.stringify(analysed?.statistics ?? {})})
      WHERE ${stillOurs}
    `),
    db.run(sql`
      UPDATE ${activityEvent} SET data = json_patch(data, lap.value -> 'data')
      FROM json_each(${JSON.stringify(analysed?.laps ?? [])}) AS lap
      WHERE ${activityEvent.userId} = ${userId} AND ${activityEvent.activityId} = ${id}
        AND ${activityEvent.type} = 'lap' AND ${activityEvent.sequence} = lap.value ->> 'sequence'
        AND ${stillOurs}
    `),
    db
      .update(activityAnalysis)
      .set({
        version: ANALYSIS_VERSION,
        due: false,
        attempts: "error" in outcome && outcome.error === "failed" ? attempts : 0,
        analyzedAt: analysed ? new Date() : null,
        error: "error" in outcome ? outcome.error : null,
        profile: fingerprint,
        missingThresholds: analysed?.missingThresholds ?? [],
      })
      .where(ours(target, attempts)),
  ]);
}

async function claim(db: Database, target: AnalysisTarget) {
  const claimed = await db
    .update(activityAnalysis)
    .set({ attempts: target.attempts + 1 })
    .where(ours(target, target.attempts))
    .returning({ attempts: activityAnalysis.attempts });
  return claimed.length > 0;
}

async function readFile(bucket: R2Bucket, { userId, id }: AnalysisTarget) {
  const object = await bucket.get(fileKey(userId, id));
  if (!object) throw new Error(`Activity ${id} has no file to analyse`);
  return new Uint8Array(await object.arrayBuffer());
}

export function needsFile(target: AnalysisTarget, fingerprint: string) {
  if (target.version < ANALYSIS_VERSION) return true;
  return target.error !== "too_large" && target.profile !== fingerprint;
}

export async function analyzeTarget(
  db: Database,
  bucket: R2Bucket,
  target: AnalysisTarget,
  history: readonly DatedChange[],
  mayReadFile: () => boolean = () => true,
) {
  const profile = profileOn(history, target.localDay);
  const fingerprint = await zonesOf(profile);
  if (!needsFile(target, fingerprint)) {
    await db.update(activityAnalysis).set({ due: false }).where(ours(target, target.attempts));
    return;
  }
  if (target.attempts >= MAX_ANALYSIS_ATTEMPTS) {
    await store(db, target, target.attempts, fingerprint, { error: "failed" });
    return;
  }
  if (!mayReadFile() || !(await claim(db, target))) return;
  const outcome = analysisOfFile(await readFile(bucket, target), profile);
  await store(db, target, target.attempts + 1, fingerprint, outcome);
}

export function dueForAnalysis(db: Database, limit = ANALYSIS_CHECKS_PER_SCHEDULED_RUN) {
  return db
    .select({
      userId: activityAnalysis.userId,
      id: activityAnalysis.activityId,
      version: activityAnalysis.version,
      generation: activityAnalysis.generation,
      attempts: activityAnalysis.attempts,
      profile: activityAnalysis.profile,
      error: activityAnalysis.error,
      localDay: activity.localDay,
      fileSize: activity.fileSize,
    })
    .from(activityAnalysis)
    .innerJoin(
      activity,
      and(
        eq(activity.userId, activityAnalysis.userId),
        eq(activity.id, activityAnalysis.activityId),
      ),
    )
    .where(or(eq(activityAnalysis.due, true), lt(activityAnalysis.version, ANALYSIS_VERSION)))
    .orderBy(asc(activityAnalysis.attempts), desc(activity.occurredAt), asc(activity.id))
    .limit(limit);
}

export async function analyzeDueActivities(db: Database, bucket: R2Bucket) {
  const due = await dueForAnalysis(db);
  const histories = new Map<string, Promise<DatedChange[]>>();
  const failures: unknown[] = [];
  let files = 0;
  let bytes = 0;
  for (const target of due) {
    const size = target.fileSize ?? 0;
    const chargeBudget = () => {
      const over =
        files >= ANALYSES_PER_SCHEDULED_RUN ||
        (files > 0 && bytes + size > ANALYSIS_BYTES_PER_SCHEDULED_RUN);
      if (over) return false;
      files += 1;
      bytes += size;
      return true;
    };
    try {
      if (!histories.has(target.userId)) {
        histories.set(target.userId, settingsHistoryOf(db, target.userId));
      }
      await analyzeTarget(db, bucket, target, await histories.get(target.userId)!, chargeBudget);
    } catch (error) {
      failures.push(error);
    }
  }
  return { attempted: due.length, failures };
}
