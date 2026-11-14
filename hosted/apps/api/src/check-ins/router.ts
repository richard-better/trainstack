import type { CheckIn } from "@trainstack/contract";
import { and, asc, between, eq, sql } from "drizzle-orm";

import { DEFAULT_TIME_ZONE, dayIn } from "../activities/local-day";
import type { Database } from "../db";
import { checkIn } from "../db/schema";
import { signedIn } from "../procedures";
import { getDb } from "../services";
import { timeZoneOf } from "../settings/router";
import { isEditedInTheFuture } from "../workouts/store";

type CheckInRow = typeof checkIn.$inferSelect;
type Answers = Omit<CheckIn, "day" | "updatedAt">;

async function athleteToday(db: Database, userId: string) {
  return dayIn((await timeZoneOf(db, userId)) ?? DEFAULT_TIME_ZONE, new Date());
}

const canonical = ({ ratings, illness, injury, note }: Answers) =>
  JSON.stringify({
    ratings: {
      sleep: ratings.sleep,
      energy: ratings.energy,
      soreness: ratings.soreness,
      stress: ratings.stress,
      mood: ratings.mood,
    },
    illness: illness && { kind: illness.kind },
    injury: injury && { area: injury.area, training: injury.training },
    note,
  });

const checkInOf = (row: CheckInRow): CheckIn => ({
  day: row.day,
  ...(JSON.parse(row.value) as Answers),
  updatedAt: row.updatedAt,
});

const heldOn = async (db: Database, userId: string, day: string) => {
  const row = await db
    .select()
    .from(checkIn)
    .where(and(eq(checkIn.userId, userId), eq(checkIn.day, day)))
    .get();
  return { day, checkIn: row && !row.removed ? checkInOf(row) : null };
};

function write(
  db: Database,
  userId: string,
  day: string,
  updatedAt: Date,
  answers: Answers | null,
) {
  return db
    .insert(checkIn)
    .values({
      userId,
      day,
      value: answers ? canonical(answers) : "",
      removed: answers === null,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [checkIn.userId, checkIn.day],
      set: {
        value: sql`excluded.value`,
        removed: sql`excluded.removed`,
        updatedAt: sql`excluded.updated_at`,
      },
      setWhere: sql`(excluded.updated_at, excluded.removed, excluded.value) > (${checkIn.updatedAt}, ${checkIn.removed}, ${checkIn.value})`,
    });
}

export const checkInsRouter = {
  put: signedIn.checkIns.put.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    if (isEditedInTheFuture(input.updatedAt)) throw errors.EDITED_IN_THE_FUTURE();
    if (input.day > (await athleteToday(db, userId))) throw errors.DAY_NOT_YET();
    const { day, updatedAt, ...answers } = input;
    await write(db, userId, day, updatedAt, answers);
    return heldOn(db, userId, day);
  }),

  remove: signedIn.checkIns.remove.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    if (isEditedInTheFuture(input.updatedAt)) throw errors.EDITED_IN_THE_FUTURE();
    await write(db, userId, input.day, input.updatedAt, null);
    return heldOn(db, userId, input.day);
  }),

  range: signedIn.checkIns.range.handler(async ({ context, input }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const [rows, today] = await Promise.all([
      db
        .select()
        .from(checkIn)
        .where(
          and(
            eq(checkIn.userId, userId),
            between(checkIn.day, input.from, input.through),
            eq(checkIn.removed, false),
          ),
        )
        .orderBy(asc(checkIn.day)),
      athleteToday(db, userId),
    ]);
    return { today, checkIns: rows.map(checkInOf) };
  }),
};
