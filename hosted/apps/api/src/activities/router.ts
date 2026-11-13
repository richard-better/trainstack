import { ORPCError } from "@orpc/server";
import type { Activity, ActivityDetail } from "@trainstack/contract";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";

import type { Database } from "../db";
import { activity, activityEvent, activityStatistic, deletedActivity } from "../db/schema";
import { ENV } from "../env.server";
import { signedIn } from "../procedures";
import { getDb } from "../services";
import { contentTypes, fileKey, formatOf, sha256Hex } from "./files";
import { summarizeActivity } from "./summary";

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

function toActivity(row: ActivityRow, statistics: Record<string, number>): Activity {
  return {
    id: row.id,
    source: row.source,
    sourceId: row.sourceId,
    sport: row.sport ?? row.fileSport,
    name: row.name ?? row.fileName,
    startedAt: row.startedAt,
    file:
      row.fileFormat && row.fileSize !== null
        ? { format: row.fileFormat, size: row.fileSize }
        : null,
    summarizedAt: row.summarizedAt,
    summaryError: row.summaryError,
    statistics,
    createdAt: row.createdAt,
  };
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
  const statistics = await statisticsOf(db, row.userId, [row.id]);
  return toActivity(row, statistics.get(row.id)!);
}

const encodeCursor = (row: ActivityRow) => `${row.occurredAt}.${row.id}`;

function decodeCursor(cursor: string) {
  const match = /^(\d+)\.([0-9a-f]{64})$/.exec(cursor);
  if (!match) throw new ORPCError("BAD_REQUEST", { message: "Invalid cursor" });
  return { occurredAt: Number(match[1]), id: match[2]! };
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
        INSERT INTO ${activity} (user_id, id, source, source_id, sport, name, started_at, file_format, file_size)
        SELECT ${userId}, ${id}, ${input.source}, ${input.sourceId ?? null}, ${input.sport ?? null},
          ${input.name ?? null}, ${input.startedAt?.getTime() ?? null}, ${format}, ${bytes.byteLength}
        WHERE NOT EXISTS (
          SELECT 1 FROM ${deletedActivity} WHERE user_id = ${userId} AND id = ${id}
        )
        ON CONFLICT DO NOTHING
      `);
    } catch (error) {
      if (!(await findActivity(db, userId, id))) {
        await ENV.ACTIVITY_FILES.delete(fileKey(userId, id));
      }
      throw error;
    }
    const inserted = await findActivity(db, userId, id);
    if (inserted) {
      try {
        await summarizeActivity(db, ENV.ACTIVITY_FILES, inserted, bytes);
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
    const statistics = await statisticsOf(
      db,
      userId,
      page.map((row) => row.id),
    );
    return {
      activities: page.map((row) => toActivity(row, statistics.get(row.id)!)),
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

  delete: signedIn.activities.delete.handler(async ({ context, input }) => {
    const db = getDb();
    const userId = context.session.user.id;
    await db.batch([
      db.insert(deletedActivity).values({ userId, id: input.id }).onConflictDoNothing(),
      db.delete(activity).where(and(eq(activity.userId, userId), eq(activity.id, input.id))),
    ]);
    await ENV.ACTIVITY_FILES.delete(fileKey(userId, input.id));
    const deletion = (await findDeletion(db, userId, input.id))!;
    return { id: deletion.id, deletedAt: deletion.deletedAt };
  }),
};
