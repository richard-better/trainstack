import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Database } from "../db";
import {
  activity,
  activityEvent,
  activityStatistic,
  type ActivityFileFormat,
  type ActivitySummaryError,
} from "../db/schema";
import { decodableFormats, decoders } from "./decoders";
import { SummaryError, type FileSummary } from "./file-summary";
import { fileKey } from "./files";

export const SUMMARY_VERSION = 1;
export const MAX_SUMMARIZED_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_SUMMARY_ATTEMPTS = 3;
export const SUMMARIES_PER_SCHEDULED_RUN = 10;

const STATISTIC_ROWS_PER_INSERT = 20;
const EVENT_ROWS_PER_INSERT = 16;

type Outcome = { summary: FileSummary } | { error: ActivitySummaryError };

export type SummaryTarget = {
  userId: string;
  id: string;
  fileFormat: ActivityFileFormat | null;
  fileSize: number | null;
  summaryAttempts: number;
};

function chunks<Item>(items: readonly Item[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

async function store(db: Database, { userId, id }: SummaryTarget, outcome: Outcome) {
  const summary = "summary" in outcome ? outcome.summary : undefined;
  const ofThisActivity = <Table extends typeof activityStatistic | typeof activityEvent>(
    table: Table,
  ) => and(eq(table.userId, userId), eq(table.activityId, id));
  const statistics = Object.entries(summary?.statistics ?? {}).map(([name, value]) => ({
    userId,
    activityId: id,
    name,
    value,
  }));
  const events = (summary?.events ?? []).map((event, sequence) => ({
    userId,
    activityId: id,
    sequence,
    ...event,
  }));
  const statements: BatchItem<"sqlite">[] = [
    db.delete(activityStatistic).where(ofThisActivity(activityStatistic)),
    db.delete(activityEvent).where(ofThisActivity(activityEvent)),
    ...chunks(statistics, STATISTIC_ROWS_PER_INSERT).map((rows) =>
      db.insert(activityStatistic).values(rows),
    ),
    ...chunks(events, EVENT_ROWS_PER_INSERT).map((rows) => db.insert(activityEvent).values(rows)),
    db
      .update(activity)
      .set({
        ...(summary?.startedAt ? { startedAt: summary.startedAt } : {}),
        fileSport: summary?.sport ?? null,
        fileName: summary?.name ?? null,
        summarizedAt: summary ? new Date() : null,
        summaryVersion: SUMMARY_VERSION,
        summaryError: "error" in outcome ? outcome.error : null,
        summaryAttempts: 0,
      })
      .where(and(eq(activity.userId, userId), eq(activity.id, id))),
  ];
  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
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
  const decode = target.fileFormat ? decoders[target.fileFormat] : undefined;
  if (!decode || target.fileSize === null) return;
  if (target.summaryAttempts >= MAX_SUMMARY_ATTEMPTS) return store(db, target, { error: "failed" });
  if (target.fileSize > MAX_SUMMARIZED_FILE_BYTES) {
    return store(db, target, { error: "too_large" });
  }
  if (!(await claim(db, target))) return;
  const file = bytes ?? (await readFile(bucket, target));
  let outcome: Outcome;
  try {
    outcome = { summary: decode(file) };
  } catch (error) {
    if (!(error instanceof SummaryError)) throw error;
    outcome = { error: error.code };
  }
  await store(db, target, outcome);
}

export function dueForSummary(db: Database, limit = SUMMARIES_PER_SCHEDULED_RUN) {
  return db
    .select({
      userId: activity.userId,
      id: activity.id,
      fileFormat: activity.fileFormat,
      fileSize: activity.fileSize,
      summaryAttempts: activity.summaryAttempts,
    })
    .from(activity)
    .where(
      and(
        inArray(activity.fileFormat, decodableFormats),
        or(
          isNull(activity.summaryVersion),
          lt(activity.summaryVersion, SUMMARY_VERSION),
          and(
            eq(activity.summaryError, "too_large"),
            lte(activity.fileSize, MAX_SUMMARIZED_FILE_BYTES),
          ),
        ),
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
