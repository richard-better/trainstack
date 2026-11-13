import { and, asc, eq, gt, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { Database } from "../db";
import { activity, activityStatistic, distinctActivities } from "../db/schema";
import { isSameWorkout, sharedMilliseconds, type Recording } from "./workout-match";

export const MATCH_VERSION = 1;
export const MATCHES_PER_SCHEDULED_RUN = 50;
const LONGEST_RECORDING_MS = 2 * 24 * 60 * 60 * 1000;

const richnessChannels = [
  "average_power_w",
  "average_heart_rate_bpm",
  "average_cadence_rpm",
  "distance_m",
  "ascent_m",
];

const workoutOf = (userId: string, id: string) =>
  sql`(SELECT workout_id FROM ${activity} WHERE user_id = ${userId} AND id = ${id})`;

export function electPrimary(db: Database, userId: string, memberId: string, leavingId = "") {
  const workout = workoutOf(userId, memberId);
  const richness = sql`(
    SELECT coalesce(sum(CASE s.name WHEN 'average_power_w' THEN 2 ELSE 1 END), 0)
    FROM ${activityStatistic} s
    WHERE s.user_id = p.user_id AND s.activity_id = p.id AND s.value > 0
      AND s.name IN (SELECT value FROM json_each(${JSON.stringify(richnessChannels)}))
  )`;
  return db.run(sql`
    UPDATE ${activity} SET is_primary = (id = (
      SELECT p.id FROM ${activity} p
      WHERE p.user_id = ${userId} AND p.workout_id = ${workout} AND p.id != ${leavingId}
      ORDER BY p.chosen_as_primary_at IS NULL, p.chosen_as_primary_at DESC, ${richness} DESC,
        p.file_size DESC, p.created_at, p.id
      LIMIT 1
    ))
    WHERE user_id = ${userId} AND workout_id = ${workout} AND id != ${leavingId}
  `);
}

export function mergeWorkouts(
  db: Database,
  userId: string,
  a: string,
  b: string,
  { evenIfDistinct = false } = {},
) {
  const workoutA = workoutOf(userId, a);
  const workoutB = workoutOf(userId, b);
  const keptApart = evenIfDistinct
    ? sql`0`
    : sql`EXISTS (
        SELECT 1 FROM ${distinctActivities} d
        JOIN ${activity} x ON x.user_id = d.user_id AND x.id = d.activity_id
        JOIN ${activity} y ON y.user_id = d.user_id AND y.id = d.other_id
        WHERE d.user_id = ${userId} AND x.workout_id = ${workoutA} AND y.workout_id = ${workoutB}
      )`;
  return db.run(sql`
    UPDATE ${activity}
    SET workout_id = (SELECT min(workout_id) FROM ${activity} WHERE user_id = ${userId} AND id IN (${a}, ${b}))
    WHERE user_id = ${userId}
      AND workout_id IN (SELECT workout_id FROM ${activity} WHERE user_id = ${userId} AND id IN (${a}, ${b}))
      AND NOT ${keptApart}
  `);
}

export function forgetDistinction(db: Database, userId: string, a: string, b: string) {
  const workoutA = workoutOf(userId, a);
  const workoutB = workoutOf(userId, b);
  return db.run(sql`
    DELETE FROM ${distinctActivities}
    WHERE user_id = ${userId}
      AND activity_id IN (SELECT id FROM ${activity} WHERE user_id = ${userId} AND workout_id IN (${workoutA}, ${workoutB}))
      AND other_id IN (SELECT id FROM ${activity} WHERE user_id = ${userId} AND workout_id IN (${workoutA}, ${workoutB}))
  `);
}

export function keepApart(db: Database, userId: string, id: string) {
  const siblings = sql`
    SELECT ${userId}, ${id}, id FROM ${activity}
    WHERE user_id = ${userId} AND workout_id = ${workoutOf(userId, id)} AND id != ${id}`;
  return [
    db.run(sql`
      INSERT INTO ${distinctActivities} (user_id, activity_id, other_id) ${siblings}
      ON CONFLICT DO NOTHING`),
    db.run(sql`
      INSERT INTO ${distinctActivities} (user_id, other_id, activity_id) ${siblings}
      ON CONFLICT DO NOTHING`),
  ] as const;
}

const elapsed = alias(activityStatistic, "elapsed");
const distance = alias(activityStatistic, "distance");

type Candidate = Recording & { id: string; workoutId: string | null };

function recordings(db: Database, userId: string, condition: SQL | undefined) {
  return db
    .select({
      id: activity.id,
      workoutId: activity.workoutId,
      sport: sql<string | null>`coalesce(${activity.sport}, ${activity.fileSport})`,
      startedAt: activity.startedAt,
      elapsedSeconds: elapsed.value,
      distanceMetres: distance.value,
    })
    .from(activity)
    .innerJoin(
      elapsed,
      and(
        eq(elapsed.userId, activity.userId),
        eq(elapsed.activityId, activity.id),
        eq(elapsed.name, "elapsed_s"),
      ),
    )
    .leftJoin(
      distance,
      and(
        eq(distance.userId, activity.userId),
        eq(distance.activityId, activity.id),
        eq(distance.name, "distance_m"),
      ),
    )
    .where(and(eq(activity.userId, userId), isNotNull(activity.startedAt), condition));
}

const asCandidate = (row: {
  id: string;
  workoutId: string | null;
  sport: string | null;
  startedAt: Date | null;
  elapsedSeconds: number;
  distanceMetres: number | null;
}): Candidate => ({
  ...row,
  startedAt: row.startedAt!,
  distanceMetres: row.distanceMetres ?? undefined,
});

async function candidatesFor(db: Database, userId: string, self: Candidate) {
  const start = self.startedAt.getTime();
  const end = start + self.elapsedSeconds * 1000;
  const rows = await recordings(
    db,
    userId,
    and(
      ne(activity.id, self.id),
      lt(activity.startedAt, new Date(end)),
      gt(activity.startedAt, new Date(start - LONGEST_RECORDING_MS)),
      sql`${activity.startedAt} + ${elapsed.value} * 1000 > ${start}`,
    ),
  );
  return rows.map(asCandidate).filter((candidate) => candidate.workoutId !== self.workoutId);
}

export async function matchActivity(db: Database, userId: string, id: string) {
  const current = await db
    .select({ summarizedAt: activity.summarizedAt })
    .from(activity)
    .where(and(eq(activity.userId, userId), eq(activity.id, id)))
    .get();
  if (!current) return;
  const [selfRow] = await recordings(db, userId, eq(activity.id, id));
  if (selfRow) {
    const self = asCandidate(selfRow);
    const matches = (await candidatesFor(db, userId, self))
      .filter((candidate) => isSameWorkout(self, candidate))
      .sort((a, b) => sharedMilliseconds(self, b) - sharedMilliseconds(self, a));
    for (const match of matches) await mergeWorkouts(db, userId, id, match.id);
  }
  await db.batch([
    electPrimary(db, userId, id),
    db
      .update(activity)
      .set({ matchVersion: MATCH_VERSION })
      .where(
        and(
          eq(activity.userId, userId),
          eq(activity.id, id),
          current.summarizedAt === null
            ? isNull(activity.summarizedAt)
            : eq(activity.summarizedAt, current.summarizedAt),
        ),
      ),
  ]);
}

export function dueForMatching(db: Database, limit = MATCHES_PER_SCHEDULED_RUN) {
  return db
    .select({ userId: activity.userId, id: activity.id })
    .from(activity)
    .where(
      and(
        isNotNull(activity.summaryVersion),
        or(isNull(activity.matchVersion), lt(activity.matchVersion, MATCH_VERSION)),
      ),
    )
    .orderBy(asc(activity.createdAt))
    .limit(limit);
}

export async function matchDueActivities(db: Database) {
  const due = await dueForMatching(db);
  const failures: unknown[] = [];
  for (const { userId, id } of due) {
    try {
      await matchActivity(db, userId, id);
    } catch (error) {
      failures.push(error);
    }
  }
  return { attempted: due.length, failures };
}
