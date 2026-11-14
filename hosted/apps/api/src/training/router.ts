import { ORPCError } from "@orpc/server";
import {
  type BestEffort,
  type BestPower,
  MAX_TRAINING_LOAD_DAYS,
  type TrainingDay,
} from "@trainstack/contract";
import {
  bestEffortDistances,
  type LoadSource,
  powerCurveDurations,
  stressByDay,
  trainingLoad,
} from "@trainstack/analysis";
import { sql } from "drizzle-orm";

import { analysisDueOf } from "../activities/analysis";
import { DEFAULT_TIME_ZONE, dayIn } from "../activities/local-day";
import type { Database } from "../db";
import { activity, activityStatistic } from "../db/schema";
import { signedIn } from "../procedures";
import { getDb } from "../services";
import { timeZoneOf } from "../settings/router";

const millisecondsPerDay = 86_400_000;
const daysApart = (from: string, through: string) =>
  (Date.parse(`${through}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / millisecondsPerDay;

async function athleteToday(db: Database, userId: string) {
  return dayIn((await timeZoneOf(db, userId)) ?? DEFAULT_TIME_ZONE, new Date());
}

type LoadRow = { id: string; day: string; stress: number; source: LoadSource };

const stressSources = sql`CASE s.name
  WHEN 'pace_stress_tss' THEN 'pace'
  WHEN 'power_stress_tss' THEN 'power'
  WHEN 'rpe_stress_tss' THEN 'rpe'
  ELSE 'heart_rate' END`;

export function loadedActivities(db: Database, userId: string, through: string) {
  return db.all<LoadRow>(sql`
    SELECT a.id AS id, a.local_day AS day, l.value AS stress, (
      SELECT ${stressSources} FROM ${activityStatistic} s
      WHERE s.user_id = a.user_id AND s.activity_id = a.id AND s.value = l.value
        AND s.name IN ('pace_stress_tss', 'power_stress_tss', 'heart_rate_stress_tss', 'rpe_stress_tss')
      ORDER BY CASE s.name WHEN 'pace_stress_tss' THEN 0 WHEN 'power_stress_tss' THEN 1 WHEN 'heart_rate_stress_tss' THEN 2 ELSE 3 END
      LIMIT 1
    ) AS source
    FROM ${activityStatistic} l
    JOIN ${activity} a ON a.user_id = l.user_id AND a.id = l.activity_id
    WHERE l.user_id = ${userId} AND l.name = 'load_tss' AND a.is_primary = 1
      AND a.local_day IS NOT NULL AND a.local_day <= ${through}
    ORDER BY a.local_day, a.id
  `);
}

type BestRow = { name: string; value: number; id: string; day: string };

function bests(
  db: Database,
  userId: string,
  prefix: string,
  pattern: string,
  best: "max" | "min",
  { from, through, sport }: { from: string; through: string; sport: string | undefined },
) {
  return db.all<BestRow>(sql`
    SELECT s.name AS name, ${sql.raw(best)}(s.value) AS value, a.id AS id, a.local_day AS day
    FROM ${activityStatistic} s
    JOIN ${activity} a ON a.user_id = s.user_id AND a.id = s.activity_id
    WHERE s.user_id = ${userId} AND s.name >= ${prefix} AND s.name < ${`${prefix}\u{10ffff}`}
      AND s.name GLOB ${pattern} AND a.is_primary = 1
      AND a.local_day BETWEEN ${from} AND ${through}
      ${sport === undefined ? sql`` : sql`AND coalesce(a.sport, a.file_sport) = ${sport}`}
    GROUP BY s.name
  `);
}

async function countAnalysesDue(
  db: Database,
  userId: string,
  { from, through, sport }: { from?: string; through: string; sport?: string | undefined },
) {
  const row = await db.get<{ due: number }>(sql`
    SELECT count(*) AS due FROM ${activity} a
    WHERE a.user_id = ${userId} AND a.is_primary = 1
      AND (a.local_day IS NULL OR (a.local_day <= ${through}
        ${from === undefined ? sql`` : sql`AND a.local_day >= ${from}`}))
      ${sport === undefined ? sql`` : sql`AND (coalesce(a.sport, a.file_sport) = ${sport} OR (a.sport IS NULL AND a.summarized_at IS NULL))`}
      AND ${analysisDueOf(sql.raw("a"))}
  `);
  return row?.due ?? 0;
}

async function readAfterCountingDue<T>(
  db: Database,
  userId: string,
  scope: { from?: string; through: string; sport?: string | undefined },
  read: () => Promise<T>,
) {
  const analysesDue = await countAnalysesDue(db, userId, scope);
  return { analysesDue, numbers: await read() };
}

export const trainingRouter = {
  load: signedIn.training.load.handler(async ({ context, input }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const today = await athleteToday(db, userId);
    const through = input.through ?? today;
    if (
      daysApart(input.from, through) < 0 ||
      daysApart(input.from, through) >= MAX_TRAINING_LOAD_DAYS
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: `from must be at most ${MAX_TRAINING_LOAD_DAYS} days before through`,
      });
    }
    const { analysesDue, numbers: rows } = await readAfterCountingDue(db, userId, { through }, () =>
      loadedActivities(db, userId, through),
    );
    const firstDay = rows[0]?.day;
    const start = firstDay !== undefined && firstDay < input.from ? firstDay : input.from;
    const byDay = new Map<string, LoadRow[]>();
    for (const row of rows) byDay.set(row.day, [...(byDay.get(row.day) ?? []), row]);
    const days: TrainingDay[] = trainingLoad(stressByDay(rows), start, through)
      .filter(({ day }) => day >= input.from)
      .map((load) => ({
        ...load,
        activities: (byDay.get(load.day) ?? []).map(({ id, stress, source }) => ({
          id,
          stress,
          source,
        })),
      }));
    return { today, days, analysesDue };
  }),

  bests: signedIn.training.bests.handler(async ({ context, input }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const period = {
      from: input.from,
      through: input.through ?? (await athleteToday(db, userId)),
      sport: input.sport,
    };
    const {
      analysesDue,
      numbers: [power, times],
    } = await readAfterCountingDue(db, userId, period, () =>
      Promise.all([
        bests(db, userId, "best_power_", "best_power_*s_w", "max", period),
        bests(db, userId, "best_time_", "best_time_*_s", "min", period),
      ]),
    );
    const byName = (rows: BestRow[]) => new Map(rows.map((row) => [row.name, row]));
    const powerByName = byName(power);
    const timesByName = byName(times);
    const powerCurve: BestPower[] = powerCurveDurations.flatMap((durationSeconds) => {
      const row = powerByName.get(`best_power_${durationSeconds}s_w`);
      return row ? [{ durationSeconds, watts: row.value, activityId: row.id, day: row.day }] : [];
    });
    const bestEfforts: BestEffort[] = bestEffortDistances.flatMap(({ name }) => {
      const row = timesByName.get(`best_time_${name}_s`);
      return row ? [{ name, seconds: row.value, activityId: row.id, day: row.day }] : [];
    });
    return { powerCurve, bestEfforts, analysesDue };
  }),
};
