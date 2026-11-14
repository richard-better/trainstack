import type {
  CalendarActivity,
  CalendarDay,
  CalendarTotals,
  PlannedContent,
} from "@trainstack/contract";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { Database } from "../db";
import { activity, activityStatistic, plannedPairingChoice, plannedWorkout } from "../db/schema";
import { type Pair, pairDay, type PairChoice } from "./pairing";
import { plannedOf, type PlannedRow } from "./planned";

const millisecondsPerDay = 86_400_000;
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / millisecondsPerDay;
const dayOf = (number: number) => new Date(number * millisecondsPerDay).toISOString().slice(0, 10);

export function daysFrom(from: string, through: string) {
  const days: string[] = [];
  for (let number = dayNumber(from); number <= dayNumber(through); number++) {
    days.push(dayOf(number));
  }
  return days;
}

export function mondayOf(day: string) {
  const number = dayNumber(day);
  const weekday = (new Date(number * millisecondsPerDay).getUTCDay() + 6) % 7;
  return dayOf(number - weekday);
}

const sundayOf = (day: string) => dayOf(dayNumber(mondayOf(day)) + 6);

type ActivityRow = {
  id: string;
  day: string;
  sport: string | null;
  indoor: number | null;
  name: string | null;
  startedAt: number | null;
  timer: number | null;
  elapsed: number | null;
  distance: number | null;
  load: number | null;
};

const calendarStatistics = ["timer_s", "elapsed_s", "distance_m", "load_tss"];

const listed = (values: readonly string[]) =>
  sql`(SELECT value FROM json_each(${JSON.stringify(values)}))`;

function activitiesOn(db: Database, userId: string, days: readonly string[]) {
  return db.all<ActivityRow>(sql`
    SELECT a.id AS id, a.local_day AS day,
      coalesce(a.sport, a.file_sport) AS sport,
      coalesce(a.indoor, a.file_indoor) AS indoor,
      coalesce(a.name, a.file_name) AS name,
      a.started_at AS startedAt,
      max(CASE s.name WHEN 'timer_s' THEN s.value END) AS timer,
      max(CASE s.name WHEN 'elapsed_s' THEN s.value END) AS elapsed,
      max(CASE s.name WHEN 'distance_m' THEN s.value END) AS distance,
      max(CASE s.name WHEN 'load_tss' THEN s.value END) AS load
    FROM ${activity} a
    LEFT JOIN ${activityStatistic} s ON s.user_id = a.user_id AND s.activity_id = a.id
      AND s.name IN (SELECT value FROM json_each(${JSON.stringify(calendarStatistics)}))
    WHERE a.user_id = ${userId} AND a.is_primary = 1 AND a.local_day IN ${listed(days)}
    GROUP BY a.id
    ORDER BY a.local_day, a.occurred_at, a.id
  `);
}

function plannedOn(db: Database, userId: string, days: readonly string[]) {
  return db
    .select()
    .from(plannedWorkout)
    .where(
      and(
        eq(plannedWorkout.userId, userId),
        inArray(plannedWorkout.day, listed(days)),
        isNull(plannedWorkout.deletedAt),
      ),
    )
    .orderBy(asc(plannedWorkout.day), asc(plannedWorkout.position), asc(plannedWorkout.id));
}

async function choicesFor(db: Database, userId: string, plannedIds: readonly string[]) {
  if (plannedIds.length === 0) return [];
  const rows = await db.all<{
    plannedId: string;
    activityId: string;
    paired: number;
    updatedAt: number;
  }>(sql`
    SELECT c.planned_id AS plannedId, c.paired AS paired, c.updated_at AS updatedAt,
      coalesce((
        SELECT p.id FROM ${activity} p
        WHERE p.user_id = a.user_id AND p.workout_id = a.workout_id AND p.is_primary = 1
        LIMIT 1
      ), a.id) AS activityId
    FROM ${plannedPairingChoice} c
    JOIN ${activity} a ON a.user_id = c.user_id AND a.id = c.activity_id
    WHERE c.user_id = ${userId} AND c.planned_id IN ${listed(plannedIds)}
  `);
  const latest = new Map<string, PairChoice>();
  for (const row of rows) {
    const choice: PairChoice = { ...row, paired: row.paired === 1 };
    const key = `${choice.plannedId} ${choice.activityId}`;
    const held = latest.get(key);
    const isLater =
      !held ||
      choice.updatedAt > held.updatedAt ||
      (choice.updatedAt === held.updatedAt && choice.paired && !held.paired);
    if (isLater) latest.set(key, choice);
  }
  return [...latest.values()];
}

const sportOf = (row: PlannedRow) =>
  row.kind === "workout"
    ? (JSON.parse(row.content!) as PlannedContent & { kind: "workout" }).workout.sport
    : null;

export type LoadedDay = {
  planned: PlannedRow[];
  activities: CalendarActivity[];
  pairs: Map<string, Pair>;
};

export async function loadDays(db: Database, userId: string, days: readonly string[]) {
  const [plannedRows, activityRows] = await Promise.all([
    plannedOn(db, userId, days),
    activitiesOn(db, userId, days),
  ]);
  const choices = await choicesFor(
    db,
    userId,
    plannedRows.map((row) => row.id),
  );
  const plannedByDay = groupBy(plannedRows, (row) => row.day!);
  const activitiesByDay = groupBy(activityRows, (row) => row.day);
  const loaded = new Map<string, LoadedDay>();
  for (const day of days) {
    const planned = plannedByDay.get(day) ?? [];
    const rows = activitiesByDay.get(day) ?? [];
    const plannedIds = new Set(planned.map((row) => row.id));
    const pairs = pairDay(
      planned.map((row) => ({
        id: row.id,
        position: row.position!,
        isWorkout: row.kind === "workout",
        skipped: row.skipped,
        sport: sportOf(row),
        seconds: row.plannedSeconds,
        load: row.plannedLoad,
      })),
      rows.map((row) => ({
        id: row.id,
        sport: row.sport,
        seconds: row.timer ?? row.elapsed,
        load: row.load,
        startedAt: row.startedAt,
      })),
      choices.filter((choice) => plannedIds.has(choice.plannedId)),
    );
    const byPlanned = new Map(pairs.map((pair) => [pair.plannedId, pair]));
    const byActivity = new Map(pairs.map((pair) => [pair.activityId, pair.plannedId]));
    loaded.set(day, {
      planned,
      activities: rows.map((row) => toActivity(row, byActivity.get(row.id) ?? null)),
      pairs: byPlanned,
    });
  }
  return loaded;
}

export async function pairingsOf(db: Database, userId: string, rows: readonly PlannedRow[]) {
  const days = [...new Set(rows.flatMap((row) => (row.day ? [row.day] : [])))];
  const loaded = await loadDays(db, userId, days);
  const pairs = new Map<string, Pair>();
  for (const day of loaded.values()) for (const [id, pair] of day.pairs) pairs.set(id, pair);
  return pairs;
}

const toActivity = (row: ActivityRow, plannedId: string | null): CalendarActivity => ({
  id: row.id,
  sport: row.sport,
  indoor: row.indoor === null ? null : row.indoor === 1,
  name: row.name,
  startedAt: row.startedAt === null ? null : new Date(row.startedAt),
  seconds: row.timer ?? row.elapsed,
  meters: row.distance,
  load: row.load,
  plannedId,
});

const zero = (): CalendarTotals => ({ seconds: 0, meters: 0, load: 0 });

function add(
  into: CalendarTotals,
  value: { seconds: number | null; meters: number | null; load: number | null },
) {
  into.seconds += value.seconds ?? 0;
  into.meters += value.meters ?? 0;
  into.load += value.load ?? 0;
}

function totalsOf(planned: PlannedRow[], activities: CalendarActivity[]) {
  const totals = { planned: zero(), completed: zero() };
  for (const row of planned) {
    if (row.kind !== "workout") continue;
    add(totals.planned, {
      seconds: row.plannedSeconds,
      meters: row.plannedMeters,
      load: row.plannedLoad,
    });
  }
  for (const done of activities) add(totals.completed, done);
  return totals;
}

function groupBy<T>(items: T[], dayOfItem: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const day = dayOfItem(item);
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }
  return groups;
}

export async function calendarRange(
  db: Database,
  userId: string,
  { from, through, today }: { from: string; through: string; today: string },
) {
  const start = mondayOf(from);
  const end = sundayOf(through);
  const loaded = await loadDays(db, userId, daysFrom(start, end));
  const dayOfRange = (day: string) => {
    const { planned, activities, pairs } = loaded.get(day)!;
    return { planned, activities, pairs, totals: totalsOf(planned, activities) };
  };
  const days: CalendarDay[] = daysFrom(from, through).map((day) => {
    const { planned, activities, pairs, totals } = dayOfRange(day);
    return {
      day,
      planned: planned.map((row) => plannedOf(row, today, pairs.get(row.id) ?? null)),
      activities,
      totals,
    };
  });
  const weeks = [];
  for (let monday = start; monday <= end; monday = dayOf(dayNumber(monday) + 7)) {
    const totals = { planned: zero(), completed: zero() };
    for (const day of daysFrom(monday, dayOf(dayNumber(monday) + 6))) {
      const { totals: ofDay } = dayOfRange(day);
      add(totals.planned, ofDay.planned);
      add(totals.completed, ofDay.completed);
    }
    weeks.push({ start: monday, totals });
  }
  return { today, days, weeks };
}
