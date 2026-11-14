import { ORPCError } from "@orpc/server";
import type { StoredWorkout, WorkoutSort, WorkoutSummary } from "@trainstack/contract";
import { MAX_WORKOUT_BYTES } from "@trainstack/contract";
import type { Workout } from "@trainstack/workout";
import { and, asc, desc, eq, gt, isNull, sql, type SQL } from "drizzle-orm";

import type { Database } from "../db";
import { workout, workoutList, workoutListEntry } from "../db/schema";
import { ALLOWED_CLOCK_AHEAD_MS } from "../settings/changes";
import { searchTerms, summaryOf } from "./summary";

type WorkoutRow = typeof workout.$inferSelect;
type Origin = NonNullable<StoredWorkout["origin"]>;

export function isEditedInTheFuture(updatedAt: Date) {
  return updatedAt.getTime() > Date.now() + ALLOWED_CLOCK_AHEAD_MS;
}

export function isTooLarge(value: Workout) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_WORKOUT_BYTES;
}

function summaryOfRow(row: WorkoutRow): WorkoutSummary {
  return {
    id: row.id,
    name: row.name!,
    sport: row.sport!,
    focus: row.focus,
    description: row.description,
    author: row.author,
    tags: row.tags ?? [],
    totals: { seconds: row.totalSeconds!, meters: row.totalMeters! },
    origin: row.origin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function storedOf(row: WorkoutRow): StoredWorkout {
  return { ...summaryOfRow(row), workout: JSON.parse(row.body!) as Workout };
}

export const findWorkout = (db: Database, userId: string, id: string) =>
  db
    .select()
    .from(workout)
    .where(and(eq(workout.userId, userId), eq(workout.id, id)))
    .get();

const nextRevision = (userId: string) =>
  sql`(SELECT coalesce(max(revision), 0) + 1 FROM ${workout} WHERE user_id = ${userId})`;

export function putWorkout(
  db: Database,
  userId: string,
  id: string,
  value: Workout,
  updatedAt: Date,
  origin: Origin | null,
) {
  const { totals, ...summary } = summaryOf(value);
  return db
    .insert(workout)
    .values({
      userId,
      id,
      ...summary,
      totalSeconds: totals.seconds,
      totalMeters: totals.meters,
      body: JSON.stringify(value),
      origin,
      updatedAt,
      revision: nextRevision(userId),
    })
    .onConflictDoUpdate({
      target: [workout.userId, workout.id],
      set: {
        name: sql`excluded.name`,
        sortName: sql`excluded.sort_name`,
        sport: sql`excluded.sport`,
        focus: sql`excluded.focus`,
        description: sql`excluded.description`,
        author: sql`excluded.author`,
        tags: sql`excluded.tags`,
        totalSeconds: sql`excluded.total_seconds`,
        totalMeters: sql`excluded.total_meters`,
        searchText: sql`excluded.search_text`,
        body: sql`excluded.body`,
        origin: sql`coalesce(excluded.origin, ${workout.origin})`,
        updatedAt: sql`excluded.updated_at`,
        revision: sql`excluded.revision`,
      },
      setWhere: sql`${workout.deletedAt} IS NULL AND (excluded.updated_at, excluded.body) > (${workout.updatedAt}, ${workout.body})`,
    });
}

export async function deleteWorkout(db: Database, userId: string, id: string) {
  const deletedAt = new Date();
  const listRevision = sql`(SELECT coalesce(max(revision), 0) + 1 FROM (
    SELECT revision FROM ${workoutList} WHERE user_id = ${userId}
    UNION ALL SELECT revision FROM ${workoutListEntry} WHERE user_id = ${userId}
  ))`;
  await db.batch([
    db
      .insert(workout)
      .values({ userId, id, updatedAt: deletedAt, deletedAt, revision: nextRevision(userId) })
      .onConflictDoUpdate({
        target: [workout.userId, workout.id],
        set: {
          name: null,
          sortName: null,
          sport: null,
          focus: null,
          description: null,
          author: null,
          tags: null,
          totalSeconds: null,
          totalMeters: null,
          searchText: null,
          body: null,
          origin: null,
          deletedAt: sql`excluded.deleted_at`,
          revision: sql`excluded.revision`,
        },
        setWhere: isNull(workout.deletedAt),
      }),
    db
      .update(workoutListEntry)
      .set({ removed: true, revision: listRevision })
      .where(
        and(
          eq(workoutListEntry.userId, userId),
          eq(workoutListEntry.workoutId, id),
          eq(workoutListEntry.removed, false),
        ),
      ),
  ]);
  const row = await findWorkout(db, userId, id);
  return { id, deletedAt: row?.deletedAt ?? deletedAt };
}

export type WorkoutFilters = {
  query?: string | undefined;
  sport?: string | undefined;
  focus?: string | undefined;
  minSeconds?: number | undefined;
  maxSeconds?: number | undefined;
  sort: WorkoutSort;
};

const sortColumns = {
  updated: { column: workout.updatedAt, descending: true },
  name: { column: workout.sortName, descending: false },
  duration: { column: workout.totalSeconds, descending: false },
} as const;

type Cursor = [WorkoutSort, number | string, string];

function encodeCursor(sort: WorkoutSort, row: WorkoutRow): string {
  const value =
    sort === "updated"
      ? row.updatedAt.getTime()
      : sort === "name"
        ? row.sortName!
        : row.totalSeconds!;
  return JSON.stringify([sort, value, row.id] satisfies Cursor);
}

function decodeCursor(sort: WorkoutSort, cursor: string) {
  const invalid = new ORPCError("BAD_REQUEST", { message: "Invalid cursor" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(cursor);
  } catch {
    throw invalid;
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) throw invalid;
  const [cursorSort, value, id] = parsed as unknown[];
  const valueType = sort === "name" ? "string" : "number";
  if (cursorSort !== sort || typeof value !== valueType || typeof id !== "string") throw invalid;
  return { value: value as number | string, id };
}

export async function listWorkouts(
  db: Database,
  userId: string,
  filters: WorkoutFilters,
  limit: number,
  cursor: string | undefined,
) {
  const { column, descending } = sortColumns[filters.sort];
  const after = cursor === undefined ? undefined : decodeCursor(filters.sort, cursor);
  const conditions: (SQL | undefined)[] = [
    eq(workout.userId, userId),
    isNull(workout.deletedAt),
    filters.sport === undefined ? undefined : eq(workout.sport, filters.sport as Workout["sport"]),
    filters.focus === undefined
      ? undefined
      : eq(workout.focus, filters.focus as NonNullable<Workout["focus"]>),
    filters.minSeconds === undefined
      ? undefined
      : sql`${workout.totalSeconds} >= ${filters.minSeconds}`,
    filters.maxSeconds === undefined
      ? undefined
      : sql`${workout.totalSeconds} <= ${filters.maxSeconds}`,
    ...searchTerms(filters.query).map((term) => sql`instr(${workout.searchText}, ${term}) > 0`),
    after === undefined
      ? undefined
      : descending
        ? sql`(${column}, ${workout.id}) < (${after.value}, ${after.id})`
        : sql`(${column}, ${workout.id}) > (${after.value}, ${after.id})`,
  ];
  const order = descending ? [desc(column), desc(workout.id)] : [asc(column), asc(workout.id)];
  const rows = await db
    .select()
    .from(workout)
    .where(and(...conditions))
    .orderBy(...order)
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    workouts: page.map(summaryOfRow),
    nextCursor: rows.length > limit ? encodeCursor(filters.sort, page.at(-1)!) : null,
  };
}

export async function workoutChanges(db: Database, userId: string, since: string | undefined) {
  const after = since === undefined ? 0 : Number(since);
  const rows = await db
    .select()
    .from(workout)
    .where(and(eq(workout.userId, userId), gt(workout.revision, after)))
    .orderBy(asc(workout.revision));
  const cursor = Math.max(after, ...rows.map((row) => row.revision));
  return {
    workouts: rows.filter((row) => row.deletedAt === null).map(storedOf),
    deleted: rows.flatMap((row) =>
      row.deletedAt ? [{ id: row.id, deletedAt: row.deletedAt }] : [],
    ),
    cursor: String(cursor),
  };
}
