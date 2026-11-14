import type { ThresholdSuggestion } from "@trainstack/contract";
import {
  detectThresholds,
  type ThresholdActivity,
  type ThresholdConfidence,
  type ThresholdEstimate,
  thresholdStatistics,
  thresholdWindowDays,
} from "@trainstack/analysis";
import {
  isValidThresholdValue,
  type Profile,
  profileOn,
  type ThresholdName,
  thresholds,
  type ThresholdValues,
  usesDefault,
  type ZoneMetric,
} from "@trainstack/zones";
import { and, eq, sql } from "drizzle-orm";

import { DEFAULT_TIME_ZONE, dayIn } from "../activities/local-day";
import { ANALYSIS_VERSION } from "../activities/analysis";
import type { Database } from "../db";
import {
  activity,
  activityAnalysis,
  activityStatistic,
  athleteSetting,
  thresholdDetection,
  thresholdAnswer,
  thresholdSuggestion,
} from "../db/schema";
import { settingsHistoryOf, timeZoneOf } from "../settings/router";

export const THRESHOLD_DETECTIONS_PER_SCHEDULED_RUN = 10;
export const REDETECT_AFTER_MS = 20 * 60 * 60 * 1000;
export const EVERY_SPORT = "";

export const meaningfulChange: Record<ThresholdName, (current: number) => number> = {
  ftp: (current) => Math.max(5, 0.03 * current),
  threshold_pace: (current) => Math.max(3, 0.02 * current),
  lactate_threshold_heart_rate: () => 3,
  max_heart_rate: () => 2,
  resting_heart_rate: () => Infinity,
  aerobic_threshold_heart_rate: () => Infinity,
  aerobic_threshold_power: () => Infinity,
};

const higherIsFitter = (threshold: ThresholdName) => threshold !== "threshold_pace";

export function worthSuggesting(
  threshold: ThresholdName,
  value: number,
  current: number | undefined,
  confidence: ThresholdConfidence,
) {
  if (current === undefined) return true;
  const change = value - current;
  if (Math.abs(change) < meaningfulChange[threshold](current)) return false;
  const fitter = higherIsFitter(threshold) ? change > 0 : change < 0;
  if (threshold === "max_heart_rate") return change > 0;
  return fitter || confidence !== "low";
}

const confidenceRank: Record<ThresholdConfidence, number> = { low: 0, medium: 1, high: 2 };

const sportOf = (scope: string) => (scope === EVERY_SPORT ? null : scope);

export function currentThreshold(profile: Profile, scope: string, threshold: ThresholdName) {
  const metric: ZoneMetric = thresholds[threshold].metric;
  const sport = sportOf(scope);
  const zones = sport === null ? profile.defaults[metric] : profile.sports[sport]?.[metric];
  return zones?.thresholds[threshold];
}

function currentFor(profile: Profile, sport: string): ThresholdValues {
  const values: ThresholdValues = {};
  for (const metric of ["heart_rate", "power", "pace"] as const) {
    const zones =
      metric === "pace"
        ? profile.sports[sport]?.pace
        : (profile.sports[sport]?.[metric] ?? profile.defaults[metric]);
    Object.assign(values, zones?.thresholds ?? {});
  }
  return values;
}

export const fingerprintOf = (estimate: ThresholdEstimate) =>
  JSON.stringify(
    estimate.evidence.map(({ activityId, statistic, value }) => [activityId, statistic, value]),
  );

type Detected = ThresholdEstimate & { scope: string };

function addressed(profile: Profile, estimate: ThresholdEstimate): Detected {
  const metric = thresholds[estimate.threshold].metric;
  const own = metric === "pace" || !usesDefault(profile, metric, estimate.sport);
  return { ...estimate, scope: own ? estimate.sport : EVERY_SPORT };
}

function preferred(a: Detected, b: Detected) {
  if (a.threshold === "max_heart_rate") return b.value > a.value ? b : a;
  const rank = confidenceRank[b.confidence] - confidenceRank[a.confidence];
  if (rank !== 0) return rank > 0 ? b : a;
  return b.day > a.day ? b : a;
}

const daysBefore = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

type StatisticRow = {
  id: string;
  day: string;
  sport: string | null;
  indoor: number | null;
  name: string;
  value: number;
};

async function activitiesOf(db: Database, userId: string, today: string) {
  const rows = await db.all<StatisticRow>(sql`
    SELECT a.id AS id, a.local_day AS day, coalesce(a.sport, a.file_sport) AS sport,
      coalesce(a.indoor, a.file_indoor) AS indoor, s.name AS name, s.value AS value
    FROM ${activity} a
    JOIN ${activityStatistic} s ON s.user_id = a.user_id AND s.activity_id = a.id
    WHERE a.user_id = ${userId} AND a.is_primary = 1
      AND a.local_day BETWEEN ${daysBefore(today, thresholdWindowDays)} AND ${today}
      AND s.name IN (SELECT value FROM json_each(${JSON.stringify(thresholdStatistics)}))
  `);
  const byId = new Map<string, ThresholdActivity & { statistics: Record<string, number> }>();
  for (const row of rows) {
    let found = byId.get(row.id);
    if (!found) {
      found = {
        id: row.id,
        day: row.day,
        sport: row.sport,
        indoor: row.indoor === 1,
        statistics: {},
      };
      byId.set(row.id, found);
    }
    found.statistics[row.name] = row.value;
  }
  return [...byId.values()];
}

export function suggestionsFrom(
  profile: Profile,
  activities: readonly ThresholdActivity[],
  today: string,
) {
  const sports = new Set(activities.flatMap(({ sport }) => (sport === null ? [] : [sport])));
  const chosen = new Map<string, Detected>();
  for (const sport of sports) {
    const detections = detectThresholds(activities, sport, {
      today,
      current: currentFor(profile, sport),
    });
    for (const detection of detections) {
      if (detection.value === null) continue;
      if (!isValidThresholdValue(detection.threshold, detection.value)) continue;
      const estimate = addressed(profile, detection);
      const key = JSON.stringify([estimate.scope, estimate.threshold]);
      const other = chosen.get(key);
      chosen.set(key, other ? preferred(other, estimate) : estimate);
    }
  }
  return [...chosen.values()].filter((estimate) =>
    worthSuggesting(
      estimate.threshold,
      estimate.value,
      currentThreshold(profile, estimate.scope, estimate.threshold),
      estimate.confidence,
    ),
  );
}

type DetectionState = { analysedThrough: number; analysedCount: number; settingsRevision: number };

async function detectionState(db: Database, userId: string): Promise<DetectionState> {
  const row = await db.get<DetectionState>(sql`
    SELECT
      coalesce((SELECT max(analyzed_at) FROM ${activityAnalysis} WHERE user_id = ${userId}), 0) AS analysedThrough,
      (SELECT count(*) FROM ${activityAnalysis} WHERE user_id = ${userId} AND analyzed_at IS NOT NULL) AS analysedCount,
      coalesce((SELECT max(revision) FROM ${athleteSetting} WHERE user_id = ${userId}), 0) AS settingsRevision
  `);
  return row ?? { analysedThrough: 0, analysedCount: 0, settingsRevision: 0 };
}

export async function detectFor(db: Database, userId: string, now = new Date()) {
  const state = await detectionState(db, userId);
  const changes = await settingsHistoryOf(db, userId);
  const today = dayIn((await timeZoneOf(db, userId)) ?? DEFAULT_TIME_ZONE, now);
  const profile = profileOn(changes, today);
  const [activities, existing, answered] = await Promise.all([
    activitiesOf(db, userId, today),
    db.select().from(thresholdSuggestion).where(eq(thresholdSuggestion.userId, userId)),
    db
      .select({
        scope: thresholdAnswer.scope,
        threshold: thresholdAnswer.threshold,
        fingerprint: thresholdAnswer.fingerprint,
      })
      .from(thresholdAnswer)
      .where(eq(thresholdAnswer.userId, userId)),
  ]);
  const wasAnswered = new Set(
    answered.map(({ scope, threshold, fingerprint }) =>
      JSON.stringify([scope, threshold, fingerprint]),
    ),
  );
  const previous = new Map(
    existing.map((row) => [JSON.stringify([row.scope, row.threshold]), row]),
  );
  const rows = suggestionsFrom(profile, activities, today).flatMap((estimate) => {
    const fingerprint = fingerprintOf(estimate);
    if (wasAnswered.has(JSON.stringify([estimate.scope, estimate.threshold, fingerprint]))) {
      return [];
    }
    const before = previous.get(JSON.stringify([estimate.scope, estimate.threshold]));
    const same =
      before?.fingerprint === fingerprint &&
      before.value === estimate.value &&
      before.effortDay === estimate.day;
    return [
      {
        userId,
        scope: estimate.scope,
        threshold: estimate.threshold,
        id: same ? before.id : crypto.randomUUID(),
        value: estimate.value,
        method: estimate.method,
        confidence: estimate.confidence,
        activityId: estimate.activityId,
        effortDay: estimate.day,
        evidence: [...estimate.evidence],
        signals: [...estimate.signals],
        fingerprint,
        detectedAt: same ? before.detectedAt : now,
      } satisfies typeof thresholdSuggestion.$inferInsert,
    ];
  });
  const record = { ...state, detectedAt: now };
  await db.batch([
    db.delete(thresholdSuggestion).where(eq(thresholdSuggestion.userId, userId)),
    ...rows.map((row) =>
      db.run(sql`
        INSERT INTO ${thresholdSuggestion} (user_id, scope, threshold, id, value, method, confidence,
          activity_id, effort_day, evidence, signals, fingerprint, detected_at)
        SELECT ${row.userId}, ${row.scope}, ${row.threshold}, ${row.id}, ${row.value}, ${row.method},
          ${row.confidence}, ${row.activityId}, ${row.effortDay}, ${JSON.stringify(row.evidence)},
          ${JSON.stringify(row.signals)}, ${row.fingerprint}, ${row.detectedAt.getTime()}
        WHERE NOT EXISTS (
          SELECT 1 FROM ${thresholdAnswer} answer
          WHERE answer.user_id = ${row.userId} AND answer.scope = ${row.scope}
            AND answer.threshold = ${row.threshold} AND answer.fingerprint = ${row.fingerprint}
        )
      `),
    ),
    db
      .insert(thresholdDetection)
      .values({ userId, ...record })
      .onConflictDoUpdate({ target: thresholdDetection.userId, set: record }),
  ]);
  return rows.length;
}

export function dueForDetection(db: Database, now: Date, limit: number) {
  return db.all<{ userId: string }>(sql`
    SELECT analysed.user_id AS userId FROM (
      SELECT user_id, max(analyzed_at) AS through, count(analyzed_at) AS n
      FROM ${activityAnalysis} GROUP BY user_id
    ) analysed
    LEFT JOIN ${thresholdDetection} d ON d.user_id = analysed.user_id
    WHERE NOT EXISTS (
        SELECT 1 FROM ${activityAnalysis} due
        WHERE due.user_id = analysed.user_id AND (due.due = 1 OR due.version < ${ANALYSIS_VERSION})
      )
      AND (d.user_id IS NULL
        OR coalesce(analysed.through, 0) != d.analysed_through
        OR analysed.n != d.analysed_count
        OR coalesce((SELECT max(revision) FROM ${athleteSetting} s WHERE s.user_id = analysed.user_id), 0) != d.settings_revision
        OR d.detected_at < ${now.getTime() - REDETECT_AFTER_MS})
    ORDER BY d.detected_at IS NOT NULL, d.detected_at
    LIMIT ${limit}
  `);
}

export async function detectDueThresholds(db: Database, now = new Date()) {
  const due = await dueForDetection(db, now, THRESHOLD_DETECTIONS_PER_SCHEDULED_RUN);
  const failures: unknown[] = [];
  for (const { userId } of due) {
    try {
      await detectFor(db, userId, now);
    } catch (error) {
      failures.push(error);
    }
  }
  return { attempted: due.length, failures };
}

export const suggestionOf = (
  row: typeof thresholdSuggestion.$inferSelect,
  current: number | undefined,
): ThresholdSuggestion => ({
  id: row.id,
  sport: sportOf(row.scope),
  threshold: row.threshold,
  value: row.value,
  current: current ?? null,
  method: row.method,
  confidence: row.confidence,
  activityId: row.activityId,
  effortDay: row.effortDay,
  evidence: row.evidence,
  signals: row.signals,
  detectedAt: row.detectedAt,
});

export const ownSuggestion = (userId: string, id: string) =>
  and(eq(thresholdSuggestion.userId, userId), eq(thresholdSuggestion.id, id));

export { sportOf };
