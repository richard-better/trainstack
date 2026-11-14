import type { HealthDay } from "@trainstack/contract";
import { and, asc, between, eq, sql } from "drizzle-orm";

import type { Database } from "../db";
import { healthDay } from "../db/schema";
import { signedIn } from "../procedures";
import { getDb } from "../services";
import { isEditedInTheFuture } from "../workouts/store";

type HealthDayRow = typeof healthDay.$inferSelect;
export type Measured = Pick<HealthDay, "sleepSeconds" | "restingHeartRateBpm" | "hrvMs">;

const canonical = ({ sleepSeconds, restingHeartRateBpm, hrvMs }: Measured) =>
  JSON.stringify({ sleepSeconds, restingHeartRateBpm, hrvMs });

export const measuredOf = (row: HealthDayRow) => JSON.parse(row.value) as Measured;

const healthDayOf = (row: HealthDayRow): HealthDay => ({
  day: row.day,
  source: row.source as HealthDay["source"],
  ...measuredOf(row),
  updatedAt: row.updatedAt,
});

export function healthDaysBetween(db: Database, userId: string, from: string, through: string) {
  return db
    .select()
    .from(healthDay)
    .where(and(eq(healthDay.userId, userId), between(healthDay.day, from, through)))
    .orderBy(asc(healthDay.day), asc(healthDay.source));
}

export const healthDaysRouter = {
  put: signedIn.healthDays.put.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    if (input.days.some(({ updatedAt }) => isEditedInTheFuture(updatedAt))) {
      throw errors.EDITED_IN_THE_FUTURE();
    }
    const writes = input.days.map(({ day, source, updatedAt, ...measured }) =>
      db
        .insert(healthDay)
        .values({ userId, source, day, value: canonical(measured), updatedAt })
        .onConflictDoUpdate({
          target: [healthDay.userId, healthDay.source, healthDay.day],
          set: { value: sql`excluded.value`, updatedAt: sql`excluded.updated_at` },
          setWhere: sql`(excluded.updated_at, excluded.value) > (${healthDay.updatedAt}, ${healthDay.value})`,
        }),
    );
    await db.batch(writes as [(typeof writes)[number], ...typeof writes]);
    const days = input.days.map(({ day }) => day).sort();
    const sent = new Set(input.days.map(({ day, source }) => `${source} ${day}`));
    const rows = await healthDaysBetween(db, userId, days[0]!, days.at(-1)!);
    return {
      days: rows.filter((row) => sent.has(`${row.source} ${row.day}`)).map(healthDayOf),
    };
  }),

  range: signedIn.healthDays.range.handler(async ({ context, input }) => ({
    days: (
      await healthDaysBetween(getDb(), context.session.user.id, input.from, input.through)
    ).map(healthDayOf),
  })),
};
