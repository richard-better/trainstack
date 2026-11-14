import { DEFAULT_TIME_ZONE, dayIn } from "../activities/local-day";
import type { Database } from "../db";
import { signedIn } from "../procedures";
import { getDb } from "../services";
import { timeZoneOf } from "../settings/router";
import { isEditedInTheFuture } from "../workouts/store";
import {
  deletePlanned,
  findPlanned,
  isContentTooLarge,
  movePlanned,
  plannedChanges,
  plannedOf,
  type PlannedRow,
  putPlanned,
  skipPlanned,
} from "./planned";
import { activityOfDay, choosePairing, forgetChoices } from "./choices";
import { calendarRange, pairingsOf } from "./range";

async function athleteToday(db: Database, userId: string) {
  return dayIn((await timeZoneOf(db, userId)) ?? DEFAULT_TIME_ZONE, new Date());
}

type Current =
  | { kind: "missing" }
  | { kind: "deleted"; deletedAt: Date }
  | { kind: "live"; row: PlannedRow };

async function current(db: Database, userId: string, id: string): Promise<Current> {
  const row = await findPlanned(db, userId, id);
  if (!row) return { kind: "missing" };
  if (row.deletedAt) return { kind: "deleted", deletedAt: row.deletedAt };
  return { kind: "live", row };
}

async function present(db: Database, userId: string, row: PlannedRow) {
  const [pairings, today] = await Promise.all([
    pairingsOf(db, userId, [row]),
    athleteToday(db, userId),
  ]);
  return plannedOf(row, today, pairings.get(row.id) ?? null);
}

export const plannedWorkoutsRouter = {
  get: signedIn.plannedWorkouts.get.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const found = await current(db, userId, input.id);
    if (found.kind === "deleted") {
      throw errors.PLANNED_WORKOUT_DELETED({ data: { id: input.id, deletedAt: found.deletedAt } });
    }
    if (found.kind === "missing") throw errors.NOT_FOUND();
    return present(db, userId, found.row);
  }),

  put: signedIn.plannedWorkouts.put.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    if (isEditedInTheFuture(input.updatedAt)) throw errors.EDITED_IN_THE_FUTURE();
    if (isContentTooLarge(input.content)) throw errors.WORKOUT_TOO_LARGE();
    const written = await putPlanned(db, userId, input);
    if (written.kind === "deleted") {
      throw errors.PLANNED_WORKOUT_DELETED({
        data: { id: input.id, deletedAt: written.deletedAt },
      });
    }
    if (written.kind !== "written") throw errors.DAY_FULL();
    return present(db, userId, written.row);
  }),

  move: signedIn.plannedWorkouts.move.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    if (isEditedInTheFuture(input.updatedAt)) throw errors.EDITED_IN_THE_FUTURE();
    const written = await movePlanned(db, userId, input);
    if (written.kind === "deleted") {
      throw errors.PLANNED_WORKOUT_DELETED({
        data: { id: input.id, deletedAt: written.deletedAt },
      });
    }
    if (written.kind === "missing") throw errors.NOT_FOUND();
    if (written.kind === "dayFull") throw errors.DAY_FULL();
    return present(db, userId, written.row);
  }),

  skip: signedIn.plannedWorkouts.skip.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    if (isEditedInTheFuture(input.updatedAt)) throw errors.EDITED_IN_THE_FUTURE();
    const found = await current(db, userId, input.id);
    if (found.kind === "deleted") {
      throw errors.PLANNED_WORKOUT_DELETED({ data: { id: input.id, deletedAt: found.deletedAt } });
    }
    if (found.kind === "missing") throw errors.NOT_FOUND();
    await skipPlanned(db, userId, input);
    const row = (await findPlanned(db, userId, input.id))!;
    if (row.deletedAt) {
      throw errors.PLANNED_WORKOUT_DELETED({ data: { id: input.id, deletedAt: row.deletedAt } });
    }
    return present(db, userId, row);
  }),

  pair: signedIn.plannedWorkouts.pair.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    if (isEditedInTheFuture(input.updatedAt)) throw errors.EDITED_IN_THE_FUTURE();
    const found = await current(db, userId, input.id);
    if (found.kind === "deleted") {
      throw errors.PLANNED_WORKOUT_DELETED({ data: { id: input.id, deletedAt: found.deletedAt } });
    }
    if (found.kind === "missing") throw errors.NOT_FOUND();
    const done = await activityOfDay(db, userId, input.activityId);
    if (!done) throw errors.ACTIVITY_NOT_FOUND();
    if (found.row.kind !== "workout" || done.day !== found.row.day) throw errors.NOT_PAIRABLE();
    await choosePairing(db, userId, { ...input, paired: true });
    const row = (await findPlanned(db, userId, input.id))!;
    if (row.deletedAt) {
      throw errors.PLANNED_WORKOUT_DELETED({ data: { id: input.id, deletedAt: row.deletedAt } });
    }
    return present(db, userId, row);
  }),

  unpair: signedIn.plannedWorkouts.unpair.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    if (isEditedInTheFuture(input.updatedAt)) throw errors.EDITED_IN_THE_FUTURE();
    const found = await current(db, userId, input.id);
    if (found.kind === "deleted") {
      throw errors.PLANNED_WORKOUT_DELETED({ data: { id: input.id, deletedAt: found.deletedAt } });
    }
    if (found.kind === "missing") throw errors.NOT_FOUND();
    if (!(await activityOfDay(db, userId, input.activityId))) throw errors.ACTIVITY_NOT_FOUND();
    await choosePairing(db, userId, { ...input, paired: false });
    const row = (await findPlanned(db, userId, input.id))!;
    if (row.deletedAt) {
      throw errors.PLANNED_WORKOUT_DELETED({ data: { id: input.id, deletedAt: row.deletedAt } });
    }
    return present(db, userId, row);
  }),

  delete: signedIn.plannedWorkouts.delete.handler(async ({ context, input }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const deletion = await deletePlanned(db, userId, input.id);
    await forgetChoices(db, userId, input.id);
    return deletion;
  }),

  changes: signedIn.plannedWorkouts.changes.handler(async ({ context, input }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const { planned, deleted, cursor } = await plannedChanges(db, userId, input.since);
    const [pairings, today] = await Promise.all([
      pairingsOf(db, userId, planned),
      athleteToday(db, userId),
    ]);
    return {
      planned: planned.map((row) => plannedOf(row, today, pairings.get(row.id) ?? null)),
      deleted,
      cursor,
    };
  }),
};

export const calendarRouter = {
  range: signedIn.calendar.range.handler(async ({ context, input }) => {
    const db = getDb();
    const userId = context.session.user.id;
    return calendarRange(db, userId, { ...input, today: await athleteToday(db, userId) });
  }),
};
