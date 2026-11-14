import type { WorkoutList } from "@trainstack/contract";
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

import type { Database } from "../db";
import { workout, workoutList, workoutListEntry } from "../db/schema";

type ListRow = typeof workoutList.$inferSelect;

const nextRevision = (userId: string) => sql`(SELECT coalesce(max(revision), 0) + 1 FROM (
  SELECT revision FROM ${workoutList} WHERE user_id = ${userId}
  UNION ALL SELECT revision FROM ${workoutListEntry} WHERE user_id = ${userId}
))`;

export const findList = (db: Database, userId: string, id: string) =>
  db
    .select()
    .from(workoutList)
    .where(and(eq(workoutList.userId, userId), eq(workoutList.id, id)))
    .get();

async function withEntries(db: Database, userId: string, rows: ListRow[]): Promise<WorkoutList[]> {
  const live = rows.filter((row) => row.deletedAt === null);
  if (live.length === 0) return [];
  const entries = await db
    .select({ listId: workoutListEntry.listId, workoutId: workoutListEntry.workoutId })
    .from(workoutListEntry)
    .where(
      and(
        eq(workoutListEntry.userId, userId),
        eq(workoutListEntry.removed, false),
        inArray(
          workoutListEntry.listId,
          sql`(SELECT value FROM json_each(${JSON.stringify(live.map((row) => row.id))}))`,
        ),
      ),
    )
    .orderBy(asc(workoutListEntry.position), asc(workoutListEntry.workoutId));
  return live.map((row) => ({
    id: row.id,
    name: row.name!,
    workoutIds: entries.filter((entry) => entry.listId === row.id).map((entry) => entry.workoutId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function listOf(db: Database, userId: string, row: ListRow) {
  const [list] = await withEntries(db, userId, [row]);
  return list!;
}

export async function allLists(db: Database, userId: string) {
  const rows = await db
    .select()
    .from(workoutList)
    .where(and(eq(workoutList.userId, userId), isNull(workoutList.deletedAt)))
    .orderBy(asc(workoutList.createdAt), asc(workoutList.id));
  return withEntries(db, userId, rows);
}

export const putList = (db: Database, userId: string, id: string, name: string, updatedAt: Date) =>
  db
    .insert(workoutList)
    .values({ userId, id, name, updatedAt, revision: nextRevision(userId) })
    .onConflictDoUpdate({
      target: [workoutList.userId, workoutList.id],
      set: {
        name: sql`excluded.name`,
        updatedAt: sql`excluded.updated_at`,
        revision: sql`excluded.revision`,
      },
      setWhere: sql`${workoutList.deletedAt} IS NULL AND (excluded.updated_at, excluded.name) > (${workoutList.updatedAt}, ${workoutList.name})`,
    });

export async function deleteList(db: Database, userId: string, id: string) {
  const deletedAt = new Date();
  await db.batch([
    db
      .insert(workoutList)
      .values({ userId, id, updatedAt: deletedAt, deletedAt, revision: nextRevision(userId) })
      .onConflictDoUpdate({
        target: [workoutList.userId, workoutList.id],
        set: {
          name: null,
          deletedAt: sql`excluded.deleted_at`,
          revision: sql`excluded.revision`,
        },
        setWhere: isNull(workoutList.deletedAt),
      }),
    db
      .delete(workoutListEntry)
      .where(and(eq(workoutListEntry.userId, userId), eq(workoutListEntry.listId, id))),
  ]);
  const row = await findList(db, userId, id);
  return { id, deletedAt: row?.deletedAt ?? deletedAt };
}

export const liveEntryCount = async (db: Database, userId: string, listId: string) =>
  (
    await db
      .select({ count: sql<number>`count(*)` })
      .from(workoutListEntry)
      .where(
        and(
          eq(workoutListEntry.userId, userId),
          eq(workoutListEntry.listId, listId),
          eq(workoutListEntry.removed, false),
        ),
      )
      .get()
  )?.count ?? 0;

export const isInList = async (db: Database, userId: string, listId: string, workoutId: string) =>
  (await db
    .select({ removed: workoutListEntry.removed })
    .from(workoutListEntry)
    .where(
      and(
        eq(workoutListEntry.userId, userId),
        eq(workoutListEntry.listId, listId),
        eq(workoutListEntry.workoutId, workoutId),
        eq(workoutListEntry.removed, false),
      ),
    )
    .get()) !== undefined;

const renumber = (db: Database, userId: string, listId: string) =>
  db.run(sql`
    UPDATE ${workoutListEntry} SET position = (
      SELECT ranked.place FROM (
        SELECT workout_id, row_number() OVER (ORDER BY position, workout_id) AS place
        FROM ${workoutListEntry}
        WHERE user_id = ${userId} AND list_id = ${listId} AND removed = 0
      ) AS ranked
      WHERE ranked.workout_id = ${workoutListEntry}.workout_id
    )
    WHERE user_id = ${userId} AND list_id = ${listId} AND removed = 0
  `);

const listIsLive = (userId: string, listId: string) =>
  sql`EXISTS (SELECT 1 FROM ${workoutList} WHERE user_id = ${userId} AND id = ${listId} AND deleted_at IS NULL)`;

export type EntryWrite = {
  listId: string;
  workoutId: string;
  updatedAt: Date;
};

export async function placeInList(
  db: Database,
  userId: string,
  { listId, workoutId, updatedAt, after }: EntryWrite & { after: string | null },
) {
  const position =
    after === null
      ? sql`0.5`
      : sql`coalesce(
          (SELECT position + 0.5 FROM ${workoutListEntry}
            WHERE user_id = ${userId} AND list_id = ${listId} AND workout_id = ${after}
              AND workout_id != ${workoutId} AND removed = 0),
          (SELECT coalesce(max(position), 0) + 1 FROM ${workoutListEntry}
            WHERE user_id = ${userId} AND list_id = ${listId} AND removed = 0)
        )`;
  await db.batch([
    renumber(db, userId, listId),
    db.run(sql`
      INSERT INTO ${workoutListEntry} (user_id, list_id, workout_id, position, removed, updated_at, revision)
      SELECT ${userId}, ${listId}, ${workoutId}, ${position}, 0, ${updatedAt.getTime()}, ${nextRevision(userId)}
      WHERE ${listIsLive(userId, listId)}
        AND EXISTS (SELECT 1 FROM ${workout} WHERE user_id = ${userId} AND id = ${workoutId} AND deleted_at IS NULL)
      ON CONFLICT DO UPDATE SET
        position = excluded.position,
        removed = 0,
        updated_at = excluded.updated_at,
        revision = excluded.revision
      WHERE (excluded.updated_at, excluded.removed) > (${workoutListEntry}.updated_at, ${workoutListEntry}.removed)
    `),
    renumber(db, userId, listId),
  ]);
}

export async function removeFromList(
  db: Database,
  userId: string,
  { listId, workoutId, updatedAt }: EntryWrite,
) {
  await db.batch([
    db.run(sql`
      INSERT INTO ${workoutListEntry} (user_id, list_id, workout_id, position, removed, updated_at, revision)
      SELECT ${userId}, ${listId}, ${workoutId}, 0, 1, ${updatedAt.getTime()}, ${nextRevision(userId)}
      WHERE ${listIsLive(userId, listId)}
      ON CONFLICT DO UPDATE SET
        removed = 1,
        updated_at = excluded.updated_at,
        revision = excluded.revision
      WHERE (excluded.updated_at, excluded.removed) > (${workoutListEntry}.updated_at, ${workoutListEntry}.removed)
    `),
    renumber(db, userId, listId),
  ]);
}

export async function listChanges(db: Database, userId: string, since: string | undefined) {
  const after = since === undefined ? 0 : Number(since);
  const entryChanged = and(
    eq(workoutListEntry.userId, userId),
    gt(workoutListEntry.revision, after),
  );
  const [entries, rows] = await db.batch([
    db
      .select({ listId: workoutListEntry.listId, revision: workoutListEntry.revision })
      .from(workoutListEntry)
      .where(entryChanged),
    db
      .select()
      .from(workoutList)
      .where(
        and(
          eq(workoutList.userId, userId),
          or(
            gt(workoutList.revision, after),
            inArray(
              workoutList.id,
              db
                .select({ listId: workoutListEntry.listId })
                .from(workoutListEntry)
                .where(entryChanged),
            ),
          ),
        ),
      )
      .orderBy(asc(workoutList.createdAt), asc(workoutList.id)),
  ]);
  const cursor = Math.max(
    after,
    ...entries.map((entry) => entry.revision),
    ...rows.map((row) => row.revision),
  );
  return {
    lists: await withEntries(db, userId, rows),
    deleted: rows.flatMap((row) =>
      row.deletedAt ? [{ id: row.id, deletedAt: row.deletedAt }] : [],
    ),
    cursor: String(cursor),
  };
}
