import type { CalendarActivity, CalendarDay, CalendarTotals } from "@trainstack/contract";
import { and, asc, between, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "../db";
import { activity, activityStatistic, plannedWorkout } from "../db/schema";
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

function activitiesOn(db: Database, userId: string, from: string, through: string) {
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
    WHERE a.user_id = ${userId} AND a.is_primary = 1 AND a.local_day BETWEEN ${from} AND ${through}
    GROUP BY a.id
    ORDER BY a.local_day, a.occurred_at, a.id
  `);
}

function plannedOn(db: Database, userId: string, from: string, through: string) {
  return db
    .select()
    .from(plannedWorkout)
    .where(
      and(
        eq(plannedWorkout.userId, userId),
        between(plannedWorkout.day, from, through),
        isNull(plannedWorkout.deletedAt),
      ),
    )
    .orderBy(asc(plannedWorkout.day), asc(plannedWorkout.position), asc(plannedWorkout.id));
}

const toActivity = (row: ActivityRow): CalendarActivity => ({
  id: row.id,
  sport: row.sport,
  indoor: row.indoor === null ? null : row.indoor === 1,
  name: row.name,
  startedAt: row.startedAt === null ? null : new Date(row.startedAt),
  seconds: row.timer ?? row.elapsed,
  meters: row.distance,
  load: row.load,
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
  const [plannedRows, activityRows] = await Promise.all([
    plannedOn(db, userId, start, end),
    activitiesOn(db, userId, start, end),
  ]);
  const plannedByDay = groupBy(plannedRows, (row) => row.day!);
  const activitiesByDay = groupBy(activityRows, (row) => row.day);
  const dayOfRange = (day: string) => {
    const planned = plannedByDay.get(day) ?? [];
    const activities = (activitiesByDay.get(day) ?? []).map(toActivity);
    return { day, planned, activities, totals: totalsOf(planned, activities) };
  };
  const days: CalendarDay[] = daysFrom(from, through).map((day) => {
    const { planned, activities, totals } = dayOfRange(day);
    return { day, planned: planned.map((row) => plannedOf(row, today)), activities, totals };
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
