import { ORPCError } from "@orpc/server";
import type { Activity, ActivityDetail, DuplicateActivity } from "@trainstack/contract";
import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";

import type { Database } from "../db";
import {
  activity,
  activityAnalysis,
  activityEvent,
  activityStatistic,
  athleteTimeZone,
  deletedActivity,
} from "../db/schema";
import { ENV } from "../env.server";
import { signedIn } from "../procedures";
import { getDb } from "../services";
import { promiseToSweepFilesAfterDeleting } from "../account/deletion";
import { contentTypes, fileKey, formatOf, sha256Hex } from "./files";
import { DEFAULT_TIME_ZONE } from "./local-day";
import { summarizeActivity } from "./summary";
import {
  electPrimary,
  forgetDistinction,
  keepApart,
  matchActivity,
  mergeWorkouts,
} from "./workouts";

type ActivityRow = typeof activity.$inferSelect;

async function statisticsOf(db: Database, userId: string, ids: string[]) {
  const byActivity = new Map<string, Record<string, number>>(ids.map((id) => [id, {}]));
  if (ids.length === 0) return byActivity;
  const rows = await db
    .select()
    .from(activityStatistic)
    .where(
      and(
        eq(activityStatistic.userId, userId),
        inArray(
          activityStatistic.activityId,
          sql`(SELECT value FROM json_each(${JSON.stringify(ids)}))`,
        ),
      ),
    );
  for (const row of rows) byActivity.get(row.activityId)![row.name] = row.value;
  return byActivity;
}

type AnalysisRow = typeof activityAnalysis.$inferSelect;

async function analysesOf(db: Database, userId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, AnalysisRow>();
  const rows = await db
    .select()
    .from(activityAnalysis)
    .where(
      and(
        eq(activityAnalysis.userId, userId),
        inArray(
          activityAnalysis.activityId,
          sql`(SELECT value FROM json_each(${JSON.stringify(ids)}))`,
        ),
      ),
    );
  return new Map(rows.map((row) => [row.activityId, row]));
}

const fileOf = (row: ActivityRow) =>
  row.fileFormat && row.fileSize !== null ? { format: row.fileFormat, size: row.fileSize } : null;

function toActivity(
  row: ActivityRow,
  statistics: Record<string, number>,
  analysis: AnalysisRow | undefined,
  duplicates: DuplicateActivity[],
): Activity {
  return {
    id: row.id,
    source: row.source,
    sourceId: row.sourceId,
    sport: row.sport ?? row.fileSport,
    indoor: row.indoor ?? row.fileIndoor,
    name: row.name ?? row.fileName,
    startedAt: row.startedAt,
    file: fileOf(row),
    summarizedAt: row.summarizedAt,
    summaryError: row.summaryError,
    localDay: row.localDay,
    localDaySource: row.localDaySource,
    statistics,
    analyzedAt: analysis?.analyzedAt ?? null,
    analysisError: analysis?.error ?? null,
    missingThresholds: analysis?.missingThresholds ?? [],
    createdAt: row.createdAt,
    primary: row.isPrimary,
    duplicates,
  };
}

async function duplicatesOf(db: Database, userId: string, rows: ActivityRow[]) {
  const workoutIds = [...new Set(rows.map((row) => row.workoutId ?? row.id))];
  const members = await db
    .select()
    .from(activity)
    .where(
      and(
        eq(activity.userId, userId),
        inArray(
          activity.workoutId,
          sql`(SELECT value FROM json_each(${JSON.stringify(workoutIds)}))`,
        ),
      ),
    )
    .orderBy(desc(activity.isPrimary), asc(activity.createdAt), asc(activity.id));
  return new Map(
    rows.map((row) => [
      row.id,
      members
        .filter((member) => member.workoutId === row.workoutId && member.id !== row.id)
        .map((member): DuplicateActivity => ({
          id: member.id,
          source: member.source,
          sourceId: member.sourceId,
          startedAt: member.startedAt,
          file: fileOf(member),
          primary: member.isPrimary,
        })),
    ]),
  );
}

async function toActivities(db: Database, userId: string, rows: ActivityRow[]) {
  const ids = rows.map((row) => row.id);
  const [statistics, analyses, duplicates] = await Promise.all([
    statisticsOf(db, userId, ids),
    analysesOf(db, userId, ids),
    duplicatesOf(db, userId, rows),
  ]);
  return rows.map((row) =>
    toActivity(row, statistics.get(row.id)!, analyses.get(row.id), duplicates.get(row.id)!),
  );
}

const findActivity = (db: Database, userId: string, id: string) =>
  db
    .select()
    .from(activity)
    .where(and(eq(activity.userId, userId), eq(activity.id, id)))
    .get();

const findDeletion = (db: Database, userId: string, id: string) =>
  db
    .select()
    .from(deletedActivity)
    .where(and(eq(deletedActivity.userId, userId), eq(deletedActivity.id, id)))
    .get();

async function withStatistics(db: Database, row: ActivityRow) {
  const [result] = await toActivities(db, row.userId, [row]);
  return result!;
}

async function currentActivity(db: Database, userId: string, id: string) {
  const row = await findActivity(db, userId, id);
  if (!row) throw new ORPCError("NOT_FOUND", { message: "No such activity" });
  return withStatistics(db, row);
}

function matchesText(query: string) {
  return or(
    sql`instr(lower(coalesce(${activity.name}, ${activity.fileName}, '')), lower(${query})) > 0`,
    sql`instr(lower(coalesce(${activity.sport}, ${activity.fileSport}, '')), lower(${query})) > 0`,
  );
}

const encodeCursor = (row: ActivityRow) => `${row.occurredAt}.${row.id}`;

function decodeCursor(cursor: string) {
  const match = /^(\d+)\.([0-9a-f]{64})$/.exec(cursor);
  if (!match) throw new ORPCError("BAD_REQUEST", { message: "Invalid cursor" });
  return { occurredAt: Number(match[1]), id: match[2]! };
}

const INDOOR_PREFIX = "indoor_";

function athleteSport(sport: string | undefined, indoor: boolean | undefined) {
  if (sport?.startsWith(INDOOR_PREFIX)) {
    return { sport: sport.slice(INDOOR_PREFIX.length), indoor: indoor ?? true };
  }
  return { sport: sport ?? null, indoor: indoor ?? null };
}

const SAME_KEY_WRITE_ATTEMPTS = 3;
const R2_SAME_KEY_WRITE_INTERVAL_MS = 1000;

async function storeFile(key: string, bytes: Uint8Array, contentType: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      await ENV.ACTIVITY_FILES.put(key, bytes, { httpMetadata: { contentType } });
      return;
    } catch (error) {
      if (await ENV.ACTIVITY_FILES.head(key)) return;
      if (attempt === SAME_KEY_WRITE_ATTEMPTS) throw error;
      await scheduler.wait(R2_SAME_KEY_WRITE_INTERVAL_MS);
    }
  }
}

export const activitiesRouter = {
  upload: signedIn.activities.upload.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    if (!(input.file instanceof Blob)) throw errors.UNSUPPORTED_FILE();
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    const format = formatOf(bytes);
    if (!format) throw errors.UNSUPPORTED_FILE();
    const id = await sha256Hex(bytes);
    const { sport, indoor } = athleteSport(input.sport, input.indoor);

    const deletedRefusal = async () => {
      const deletion = await findDeletion(db, userId, id);
      return deletion && errors.ACTIVITY_DELETED({ data: { id, deletedAt: deletion.deletedAt } });
    };

    const deletedBeforeUpload = await deletedRefusal();
    if (deletedBeforeUpload) throw deletedBeforeUpload;
    const existing = await findActivity(db, userId, id);
    if (existing) return withStatistics(db, existing);

    await storeFile(fileKey(userId, id), bytes, contentTypes[format]);
    try {
      await db.run(sql`
        INSERT INTO ${activity} (user_id, id, workout_id, source, source_id, sport, indoor, name, started_at, file_format, file_size, local_day_source, local_day_zone)
        SELECT ${userId}, ${id}, ${id}, ${input.source}, ${input.sourceId ?? null}, ${sport}, ${indoor},
          ${input.name ?? null}, ${input.startedAt?.getTime() ?? null}, ${format}, ${bytes.byteLength},
          'time_zone', coalesce(
            (SELECT time_zone FROM ${athleteTimeZone} WHERE user_id = ${userId}), ${DEFAULT_TIME_ZONE}
          )
        WHERE NOT EXISTS (
          SELECT 1 FROM ${deletedActivity} WHERE user_id = ${userId} AND id = ${id}
        )
        ON CONFLICT DO NOTHING
      `);
    } catch (error) {
      if (!(await findActivity(db, userId, id))) {
        await ENV.ACTIVITY_FILES.delete(fileKey(userId, id)).catch(() =>
          promiseToSweepFilesAfterDeleting(db, userId),
        );
      }
      throw error;
    }
    const inserted = await findActivity(db, userId, id);
    if (inserted) {
      try {
        await summarizeActivity(db, ENV.ACTIVITY_FILES, inserted, bytes);
        await matchActivity(db, userId, id);
      } catch (error) {
        console.error(error);
      }
      const current = await findActivity(db, userId, id);
      if (current) return withStatistics(db, current);
    }
    const deletedDuringUpload = await deletedRefusal();
    await ENV.ACTIVITY_FILES.delete(fileKey(userId, id));
    throw deletedDuringUpload ?? new Error(`Activity ${id} was neither stored nor deleted`);
  }),

  list: signedIn.activities.list.handler(async ({ context, input }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const after = input.cursor ? decodeCursor(input.cursor) : undefined;
    const rows = await db
      .select()
      .from(activity)
      .where(
        and(
          eq(activity.userId, userId),
          input.onePerWorkout ? eq(activity.isPrimary, true) : undefined,
          input.startedAfter ? gte(activity.occurredAt, input.startedAfter.getTime()) : undefined,
          input.startedBefore ? lt(activity.occurredAt, input.startedBefore.getTime()) : undefined,
          input.query ? matchesText(input.query) : undefined,
          after
            ? or(
                lt(activity.occurredAt, after.occurredAt),
                and(eq(activity.occurredAt, after.occurredAt), lt(activity.id, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(activity.occurredAt), desc(activity.id))
      .limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    return {
      activities: await toActivities(db, userId, page),
      nextCursor: rows.length > input.limit ? encodeCursor(page.at(-1)!) : null,
    };
  }),

  get: signedIn.activities.get.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const row = await findActivity(db, userId, input.id);
    if (!row) throw errors.NOT_FOUND();
    const events = await db
      .select()
      .from(activityEvent)
      .where(and(eq(activityEvent.userId, userId), eq(activityEvent.activityId, input.id)))
      .orderBy(asc(activityEvent.sequence));
    const detail: ActivityDetail = {
      ...(await withStatistics(db, row)),
      events: events.map(({ type, startedAt, endedAt, data }) => ({
        type,
        startedAt,
        endedAt,
        data,
      })),
    };
    return detail;
  }),

  file: signedIn.activities.file.handler(async ({ context, input, errors }) => {
    const userId = context.session.user.id;
    const row = await findActivity(getDb(), userId, input.id);
    const format = row?.fileFormat;
    if (!format) throw errors.NOT_FOUND();
    const object = await ENV.ACTIVITY_FILES.get(fileKey(userId, input.id));
    if (!object) throw errors.NOT_FOUND();
    return new File([await object.arrayBuffer()], `${input.id}.${format}`, {
      type: contentTypes[format],
    });
  }),

  makePrimary: signedIn.activities.makePrimary.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    if (!(await findActivity(db, userId, input.id))) throw errors.NOT_FOUND();
    await db.batch([
      db
        .update(activity)
        .set({ chosenAsPrimaryAt: new Date() })
        .where(and(eq(activity.userId, userId), eq(activity.id, input.id))),
      electPrimary(db, userId, input.id),
    ]);
    return currentActivity(db, userId, input.id);
  }),

  unlink: signedIn.activities.unlink.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    if (!(await findActivity(db, userId, input.id))) throw errors.NOT_FOUND();
    await db.batch([
      ...keepApart(db, userId, input.id),
      electPrimary(db, userId, input.id, input.id),
      db
        .update(activity)
        .set({ workoutId: crypto.randomUUID(), isPrimary: true })
        .where(and(eq(activity.userId, userId), eq(activity.id, input.id))),
    ]);
    return currentActivity(db, userId, input.id);
  }),

  link: signedIn.activities.link.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const [row, other] = await Promise.all([
      findActivity(db, userId, input.id),
      findActivity(db, userId, input.to),
    ]);
    if (!row || !other) throw errors.NOT_FOUND();
    await db.batch([
      forgetDistinction(db, userId, input.id, input.to),
      mergeWorkouts(db, userId, input.id, input.to, { evenIfDistinct: true }),
      electPrimary(db, userId, input.id),
    ]);
    return currentActivity(db, userId, input.id);
  }),

  delete: signedIn.activities.delete.handler(async ({ context, input }) => {
    const db = getDb();
    const userId = context.session.user.id;
    await db.batch([
      electPrimary(db, userId, input.id, input.id),
      db.insert(deletedActivity).values({ userId, id: input.id }).onConflictDoNothing(),
      db.delete(activity).where(and(eq(activity.userId, userId), eq(activity.id, input.id))),
    ]);
    await ENV.ACTIVITY_FILES.delete(fileKey(userId, input.id));
    const deletion = (await findDeletion(db, userId, input.id))!;
    return { id: deletion.id, deletedAt: deletion.deletedAt };
  }),
};
