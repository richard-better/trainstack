import { ORPCError } from "@orpc/server";
import { MAX_PROGRESS_DAYS, type BoulderingPoint, type StrengthPoint } from "@trainstack/contract";
import {
  boulderingSummary,
  catalogueExercise,
  exerciseCatalogue,
  exerciseNumbers,
  gradePyramid,
  type LoggedSession,
  mergedNumbers,
  preferredUnit,
} from "@trainstack/logbook";
import { and, asc, between, eq, sql } from "drizzle-orm";

import { deleteActivity, findDeletion } from "../activities/router";
import { DEFAULT_TIME_ZONE, dayIn } from "../activities/local-day";
import { electPrimary, matchActivity } from "../activities/workouts";
import type { Database } from "../db";
import {
  activity,
  activityStatistic,
  customExercise,
  deletedActivity,
  loggedSession,
} from "../db/schema";
import { signedIn } from "../procedures";
import { getDb } from "../services";
import { settingsHistoryOf, timeZoneOf } from "../settings/router";
import { isEditedInTheFuture } from "../workouts/store";
import {
  activityIdOf,
  bodyMassOn,
  bodyOf,
  gradeValue,
  indoorOf,
  LOGBOOK_SOURCE,
  sessionOf,
  sessionRows,
  statisticsOf,
  storedOf,
} from "./sessions";

const findSessionRow = async (db: Database, userId: string, id: string) =>
  (await sessionRows(db, userId, eq(loggedSession.id, id)))[0];

async function dayOfSession(db: Database, userId: string, activityId: string, startedAt: Date) {
  const existing = await db
    .select({ zone: activity.localDayZone })
    .from(activity)
    .where(and(eq(activity.userId, userId), eq(activity.id, activityId)))
    .get();
  const zone = existing?.zone ?? (await timeZoneOf(db, userId)) ?? DEFAULT_TIME_ZONE;
  return { day: dayIn(zone, startedAt), zone };
}

async function unknownExercise(db: Database, userId: string, session: LoggedSession) {
  if (session.detail.sport !== "strength") return undefined;
  const ids = [...new Set(session.detail.exercises.map(({ exerciseId }) => exerciseId))];
  const custom = ids.filter((id) => !catalogueExercise(id));
  if (custom.length === 0) return undefined;
  const known = new Set(
    (
      await db
        .select({ id: customExercise.id })
        .from(customExercise)
        .where(
          and(
            eq(customExercise.userId, userId),
            sql`${customExercise.id} IN (SELECT value FROM json_each(${JSON.stringify(custom)}))`,
          ),
        )
    ).map(({ id }) => id),
  );
  return custom.find((id) => !known.has(id));
}

function writeSession(
  db: Database,
  userId: string,
  input: { id: string; session: LoggedSession; editedAt: Date },
  activityId: string,
  { day, zone }: { day: string; zone: string },
) {
  const { id, session, editedAt } = input;
  const body = bodyOf(session);
  const sport = session.detail.sport;
  const indoor = indoorOf(session);
  const startedAt = session.startedAt.getTime();
  const statistics = JSON.stringify(statisticsOf(session));
  const ours = sql`EXISTS (SELECT 1 FROM ${loggedSession} WHERE user_id = ${userId} AND id = ${id} AND edited_at = ${editedAt.getTime()} AND body = ${body})`;
  const movedWhileLinked = sql`EXISTS (
    SELECT 1 FROM ${activity} a
    LEFT JOIN ${activityStatistic} e ON e.user_id = a.user_id AND e.activity_id = a.id AND e.name = 'elapsed_s'
    WHERE a.user_id = ${userId} AND a.id = ${activityId}
      AND (a.started_at IS NOT ${startedAt} OR a.sport IS NOT ${sport} OR e.value IS NOT ${session.durationSeconds})
      AND EXISTS (SELECT 1 FROM ${activity} o WHERE o.user_id = a.user_id AND o.workout_id = a.workout_id AND o.id != a.id)
  )`;
  const leaving = sql`(${ours} AND ${movedWhileLinked})`;
  return db.batch([
    db.run(sql`
      INSERT INTO ${activity} (user_id, id, workout_id, source, source_id, sport, indoor, name, started_at, local_day, local_day_source, local_day_zone)
      SELECT ${userId}, ${activityId}, ${activityId}, ${LOGBOOK_SOURCE}, ${id}, ${sport}, ${indoor},
        ${session.name}, ${startedAt}, ${day}, 'time_zone', ${zone}
      WHERE NOT EXISTS (SELECT 1 FROM ${deletedActivity} WHERE user_id = ${userId} AND id = ${activityId})
      ON CONFLICT DO NOTHING
    `),
    db.run(sql`
      INSERT INTO ${loggedSession} (user_id, id, activity_id, sport, body, edited_at)
      SELECT ${userId}, ${id}, ${activityId}, ${sport}, ${body}, ${editedAt.getTime()}
      WHERE EXISTS (SELECT 1 FROM ${activity} WHERE user_id = ${userId} AND id = ${activityId})
      ON CONFLICT (user_id, id) DO UPDATE SET
        sport = excluded.sport, body = excluded.body, edited_at = excluded.edited_at
      WHERE (excluded.edited_at, excluded.body) > (${loggedSession.editedAt}, ${loggedSession.body})
    `),
    electPrimary(db, userId, activityId, activityId, leaving),
    db.run(sql`
      UPDATE ${activity} SET workout_id = ${crypto.randomUUID()}, is_primary = 1
      WHERE user_id = ${userId} AND id = ${activityId} AND ${leaving}
    `),
    db.run(sql`
      UPDATE ${activity} SET sport = ${sport}, indoor = ${indoor}, name = ${session.name},
        started_at = ${startedAt}, local_day = ${day}
      WHERE user_id = ${userId} AND id = ${activityId} AND ${ours}
    `),
    db.run(sql`
      DELETE FROM ${activityStatistic} WHERE user_id = ${userId} AND activity_id = ${activityId} AND ${ours}
    `),
    db.run(sql`
      INSERT INTO ${activityStatistic} (user_id, activity_id, name, value)
      SELECT ${userId}, ${activityId}, key, value FROM json_each(${statistics}) WHERE ${ours}
    `),
  ]);
}

function inPeriod(from: string, through: string) {
  const days = (Date.parse(`${through}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days < 0 || days >= MAX_PROGRESS_DAYS) {
    throw new ORPCError("BAD_REQUEST", {
      message: `from must be on or before through, and at most ${MAX_PROGRESS_DAYS} days before it`,
    });
  }
  return between(activity.localDay, from, through);
}

const hasExercise = (exerciseId: string) =>
  sql`EXISTS (SELECT 1 FROM json_each(${loggedSession.body}, '$.detail.exercises') e WHERE e.value ->> 'exerciseId' = ${exerciseId})`;

const storedExerciseOf = (row: typeof customExercise.$inferSelect) => ({
  id: row.id,
  name: row.name,
  equipment: row.equipment,
  primaryMuscles: row.primaryMuscles,
  secondaryMuscles: row.secondaryMuscles,
  measure: row.measure,
  bodyweight: row.bodyweight,
  editedAt: row.editedAt,
  createdAt: row.createdAt,
});

export const logbookRouter = {
  put: signedIn.logbook.put.handler(async ({ context, input, errors }) => {
    if (isEditedInTheFuture(input.editedAt)) throw errors.EDITED_IN_THE_FUTURE();
    const db = getDb();
    const userId = context.session.user.id;
    const activityId = await activityIdOf(input.id);
    const deletedRefusal = async () => {
      const deletion = await findDeletion(db, userId, activityId);
      return (
        deletion &&
        errors.SESSION_DELETED({ data: { id: input.id, deletedAt: deletion.deletedAt } })
      );
    };
    const deleted = await deletedRefusal();
    if (deleted) throw deleted;
    const unknown = await unknownExercise(db, userId, input.session);
    if (unknown) throw errors.UNKNOWN_EXERCISE({ data: { exerciseId: unknown } });
    const day = await dayOfSession(db, userId, activityId, input.session.startedAt);
    await writeSession(db, userId, input, activityId, day);
    const row = await findSessionRow(db, userId, input.id);
    if (!row) {
      throw (
        (await deletedRefusal()) ?? new Error(`Session ${input.id} was neither stored nor deleted`)
      );
    }
    await matchActivity(db, userId, activityId);
    return storedOf(db, userId, row);
  }),

  get: signedIn.logbook.get.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const row = await findSessionRow(db, userId, input.id);
    if (row) return storedOf(db, userId, row);
    const deletion = await findDeletion(db, userId, await activityIdOf(input.id));
    if (deletion)
      throw errors.SESSION_DELETED({ data: { id: input.id, deletedAt: deletion.deletedAt } });
    throw errors.NOT_FOUND();
  }),

  latest: signedIn.logbook.latest.handler(async ({ context, input }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const [row] = await sessionRows(
      db,
      userId,
      and(
        eq(loggedSession.sport, input.sport),
        input.exerciseId === undefined ? undefined : hasExercise(input.exerciseId),
      ),
      { latestFirst: true },
    ).limit(1);
    return row ? storedOf(db, userId, row) : null;
  }),

  delete: signedIn.logbook.delete.handler(async ({ context, input }) => {
    const deletion = await deleteActivity(
      getDb(),
      context.session.user.id,
      await activityIdOf(input.id),
    );
    return { id: input.id, deletedAt: deletion.deletedAt };
  }),

  exercises: signedIn.logbook.exercises.handler(async ({ context }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const [custom, used] = await Promise.all([
      db
        .select()
        .from(customExercise)
        .where(eq(customExercise.userId, userId))
        .orderBy(asc(sql`lower(${customExercise.name})`), asc(customExercise.id)),
      db.all<{ exerciseId: string; sessions: number; lastDay: string }>(sql`
        SELECT e.value ->> 'exerciseId' AS exerciseId, count(DISTINCT s.id) AS sessions,
          max(a.local_day) AS lastDay
        FROM ${loggedSession} s
        JOIN ${activity} a ON a.user_id = s.user_id AND a.id = s.activity_id
        JOIN json_each(s.body, '$.detail.exercises') e
        WHERE s.user_id = ${userId} AND s.sport = 'strength' AND a.local_day IS NOT NULL
        GROUP BY 1
        ORDER BY 3 DESC, 2 DESC, 1
      `),
    ]);
    return {
      catalogue: exerciseCatalogue.map((exercise) => ({
        ...exercise,
        primaryMuscles: [...exercise.primaryMuscles],
        secondaryMuscles: [...exercise.secondaryMuscles],
      })),
      custom: custom.map(storedExerciseOf),
      used,
    };
  }),

  putExercise: signedIn.logbook.putExercise.handler(async ({ context, input, errors }) => {
    if (isEditedInTheFuture(input.editedAt)) throw errors.EDITED_IN_THE_FUTURE();
    const db = getDb();
    const userId = context.session.user.id;
    const { id, exercise, editedAt } = input;
    await db
      .insert(customExercise)
      .values({ userId, id, ...exercise, editedAt })
      .onConflictDoUpdate({
        target: [customExercise.userId, customExercise.id],
        set: {
          name: sql`excluded.name`,
          equipment: sql`excluded.equipment`,
          primaryMuscles: sql`excluded.primary_muscles`,
          secondaryMuscles: sql`excluded.secondary_muscles`,
          measure: sql`excluded.measure`,
          bodyweight: sql`excluded.bodyweight`,
          editedAt: sql`excluded.edited_at`,
        },
        setWhere: sql`(excluded.edited_at, excluded.name, excluded.equipment, excluded.primary_muscles, excluded.secondary_muscles, excluded.measure, excluded.bodyweight) > (${customExercise.editedAt}, ${customExercise.name}, ${customExercise.equipment}, ${customExercise.primaryMuscles}, ${customExercise.secondaryMuscles}, ${customExercise.measure}, ${customExercise.bodyweight})`,
      });
    const row = await db
      .select()
      .from(customExercise)
      .where(and(eq(customExercise.userId, userId), eq(customExercise.id, id)))
      .get();
    return storedExerciseOf(row!);
  }),

  strengthProgress: signedIn.logbook.strengthProgress.handler(async ({ context, input }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const rows = await sessionRows(
      db,
      userId,
      and(
        eq(loggedSession.sport, "strength"),
        inPeriod(input.from, input.through),
        hasExercise(input.exerciseId),
      ),
    );
    const massOn = bodyMassOn(await settingsHistoryOf(db, userId));
    const entries = [];
    const points: StrengthPoint[] = [];
    for (const row of rows) {
      const { detail } = sessionOf(row.body);
      if (detail.sport !== "strength") continue;
      const mine = detail.exercises.filter(({ exerciseId }) => exerciseId === input.exerciseId);
      entries.push(...mine);
      const [numbers] = mergedNumbers(
        mine.map((entry) => exerciseNumbers(entry, massOn(row.localDay))),
      );
      if (numbers) {
        points.push({ sessionId: row.id, activityId: row.activityId, day: row.localDay!, numbers });
      }
    }
    return {
      points,
      unit: preferredUnit({ sport: "strength", exercises: entries }),
    };
  }),

  boulderingProgress: signedIn.logbook.boulderingProgress.handler(async ({ context, input }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const rows = await sessionRows(
      db,
      userId,
      and(eq(loggedSession.sport, "bouldering"), inPeriod(input.from, input.through)),
    );
    const details = rows.flatMap((row) => {
      const { detail } = sessionOf(row.body);
      return detail.sport === "bouldering" ? [{ row, detail }] : [];
    });
    const sessions: BoulderingPoint[] = details.map(({ row, detail }) => {
      const summary = boulderingSummary(detail);
      return {
        sessionId: row.id,
        activityId: row.activityId,
        day: row.localDay!,
        venue: detail.venue.name,
        problems: summary.problems,
        tops: summary.tops,
        sends: summary.sends,
        attempts: summary.attempts,
        hardestTop: gradeValue(summary.hardestTop),
      };
    });
    return {
      sessions,
      pyramid: gradePyramid(
        details.map(({ detail }) => detail),
        input.scale,
      ),
      circuits: [
        ...new Set(details.flatMap(({ detail }) => (detail.circuit ? [detail.circuit.name] : []))),
      ].sort(),
    };
  }),
};
