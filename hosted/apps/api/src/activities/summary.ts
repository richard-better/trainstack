import { and, asc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import type { Database } from "../db";
import {
  activity,
  activityEvent,
  activityStatistic,
  type ActivityFileFormat,
  type ActivitySummaryError,
} from "../db/schema";
import { summaryOfFile } from "./activity-file";
import { SummaryError, type FileSummary } from "./file-summary";
import { fileKey } from "./files";

export const SUMMARY_VERSION = 3;
export const MAX_SUMMARY_ATTEMPTS = 3;
export const SUMMARIES_PER_SCHEDULED_RUN = 5;
export const MAX_EVENTS_PER_ACTIVITY = 2000;

type Outcome = { summary: FileSummary } | { error: ActivitySummaryError };

export type SummaryTarget = {
  userId: string;
  id: string;
  fileFormat: ActivityFileFormat | null;
  summaryAttempts: number;
};

async function store(
  db: Database,
  { userId, id }: SummaryTarget,
  attemptsWhenStarted: number,
  outcome: Outcome,
) {
  const summary = "summary" in outcome ? outcome.summary : undefined;
  const stillOurs = sql`EXISTS (SELECT 1 FROM ${activity} WHERE user_id = ${userId} AND id = ${id} AND summary_attempts = ${attemptsWhenStarted})`;
  const statistics = JSON.stringify(summary?.statistics ?? {});
  const events = JSON.stringify(
    (summary?.events ?? []).slice(0, MAX_EVENTS_PER_ACTIVITY).map((event) => ({
      type: event.type,
      startedAt: event.startedAt.getTime(),
      endedAt: event.endedAt?.getTime() ?? null,
      data: event.data,
    })),
  );
  await db.batch([
    db.run(
      sql`DELETE FROM ${activityStatistic} WHERE user_id = ${userId} AND activity_id = ${id} AND ${stillOurs}`,
    ),
    db.run(
      sql`DELETE FROM ${activityEvent} WHERE user_id = ${userId} AND activity_id = ${id} AND ${stillOurs}`,
    ),
    db.run(sql`
      INSERT INTO ${activityStatistic} (user_id, activity_id, name, value)
      SELECT ${userId}, ${id}, key, value FROM json_each(${statistics}) WHERE ${stillOurs}
    `),
    db.run(sql`
      INSERT INTO ${activityEvent} (user_id, activity_id, sequence, type, started_at, ended_at, data)
      SELECT ${userId}, ${id}, key, value ->> 'type', value ->> 'startedAt', value ->> 'endedAt', value -> 'data'
      FROM json_each(${events}) WHERE ${stillOurs}
    `),
    db
      .update(activity)
      .set({
        ...(summary?.startedAt ? { startedAt: summary.startedAt } : {}),
        fileSport: summary?.sport ?? null,
        fileIndoor: summary?.indoor ?? null,
        fileName: summary?.name ?? null,
        summarizedAt: summary ? new Date() : null,
        summaryVersion: SUMMARY_VERSION,
        summaryError: "error" in outcome ? outcome.error : null,
        summaryAttempts: 0,
        matchVersion: null,
      })
      .where(
        and(
          eq(activity.userId, userId),
          eq(activity.id, id),
          eq(activity.summaryAttempts, attemptsWhenStarted),
        ),
      ),
  ]);
}

async function claim(db: Database, { userId, id, summaryAttempts }: SummaryTarget) {
  const claimed = await db
    .update(activity)
    .set({ summaryAttempts: summaryAttempts + 1 })
    .where(
      and(
        eq(activity.userId, userId),
        eq(activity.id, id),
        eq(activity.summaryAttempts, summaryAttempts),
      ),
    )
    .returning({ id: activity.id });
  return claimed.length > 0;
}

async function readFile(bucket: R2Bucket, { userId, id }: SummaryTarget) {
  const object = await bucket.get(fileKey(userId, id));
  if (!object) throw new Error(`Activity ${id} has no file to summarise`);
  return new Uint8Array(await object.arrayBuffer());
}

export async function summarizeActivity(
  db: Database,
  bucket: R2Bucket,
  target: SummaryTarget,
  bytes?: Uint8Array,
) {
  if (target.fileFormat === null) return;
  if (target.summaryAttempts >= MAX_SUMMARY_ATTEMPTS) {
    return store(db, target, target.summaryAttempts, { error: "failed" });
  }
  if (!(await claim(db, target))) return;
  const file = bytes ?? (await readFile(bucket, target));
  let outcome: Outcome;
  try {
    outcome = { summary: summaryOfFile(file) };
  } catch (error) {
    if (!(error instanceof SummaryError)) throw error;
    outcome = { error: error.code };
  }
  await store(db, target, target.summaryAttempts + 1, outcome);
}

export function dueForSummary(db: Database, limit = SUMMARIES_PER_SCHEDULED_RUN) {
  return db
    .select({
      userId: activity.userId,
      id: activity.id,
      fileFormat: activity.fileFormat,
      summaryAttempts: activity.summaryAttempts,
    })
    .from(activity)
    .where(
      and(
        isNotNull(activity.fileFormat),
        or(isNull(activity.summaryVersion), lt(activity.summaryVersion, SUMMARY_VERSION)),
      ),
    )
    .orderBy(asc(activity.summaryAttempts), asc(activity.createdAt))
    .limit(limit);
}

export async function summarizeDueActivities(db: Database, bucket: R2Bucket) {
  const due = await dueForSummary(db);
  const failures: unknown[] = [];
  for (const target of due) {
    try {
      await summarizeActivity(db, bucket, target);
    } catch (error) {
      failures.push(error);
    }
  }
  return { attempted: due.length, failures };
}
