import type { CheckIn } from "@trainstack/contract";
import { stressByDay } from "@trainstack/analysis";
import {
  checkInBaseline,
  type ReadinessPlanned,
  readinessRange,
  recentIllnessDays,
} from "@trainstack/readiness";
import { and, between, eq } from "drizzle-orm";

import { DEFAULT_TIME_ZONE, dayIn } from "../activities/local-day";
import { loadDays } from "../calendar/range";
import { stateOf } from "../calendar/planned";
import type { Database } from "../db";
import { checkIn } from "../db/schema";
import { signedIn } from "../procedures";
import { getDb } from "../services";
import { timeZoneOf } from "../settings/router";
import { loadedActivities } from "../training/router";

const millisecondsPerDay = 86_400_000;
const shift = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * millisecondsPerDay).toISOString().slice(0, 10);

async function athleteToday(db: Database, userId: string) {
  return dayIn((await timeZoneOf(db, userId)) ?? DEFAULT_TIME_ZONE, new Date());
}

async function checkInsAround(db: Database, userId: string, from: string, through: string) {
  const rows = await db
    .select()
    .from(checkIn)
    .where(
      and(
        eq(checkIn.userId, userId),
        between(
          checkIn.day,
          shift(from, -Math.max(checkInBaseline.days, recentIllnessDays)),
          through,
        ),
        eq(checkIn.removed, false),
      ),
    );
  return rows.map((row) => ({
    day: row.day,
    ...(JSON.parse(row.value) as Omit<CheckIn, "day" | "updatedAt">),
  }));
}

async function plannedOn(db: Database, userId: string, days: readonly string[], today: string) {
  const loaded = await loadDays(db, userId, days);
  const planned = new Map<string, ReadinessPlanned[]>();
  for (const [day, { planned: rows, presented }] of loaded) {
    planned.set(
      day,
      rows.map((row) => ({
        id: row.id,
        kind: row.kind as ReadinessPlanned["kind"],
        state: stateOf(row, today, presented.get(row.id)?.pairing ?? null),
        seconds: row.plannedSeconds,
        load: row.plannedLoad,
      })),
    );
  }
  return planned;
}

export const readinessRouter = {
  range: signedIn.readiness.range.handler(async ({ context, input }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const today = await athleteToday(db, userId);
    if (input.from > today) return { today, days: [] };
    const through = input.through < today ? input.through : today;
    const [checkIns, loaded, planned] = await Promise.all([
      checkInsAround(db, userId, input.from, through),
      loadedActivities(db, userId, shift(through, -1)),
      plannedOn(db, userId, through === today ? [today] : [], today),
    ]);
    return {
      today,
      days: readinessRange({ checkIns, stress: stressByDay(loaded), planned }, input.from, through),
    };
  }),
};
