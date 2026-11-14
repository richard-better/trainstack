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
import { calendarRange } from "./range";

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

async function respond(db: Database, userId: string, id: string) {
  const [row, today] = await Promise.all([findPlanned(db, userId, id), athleteToday(db, userId)]);
  return { row: row!, today };
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
    return plannedOf(found.row, await athleteToday(db, userId));
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
    return plannedOf(written.row, await athleteToday(db, userId));
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
    return plannedOf(written.row, await athleteToday(db, userId));
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
    const { row, today } = await respond(db, userId, input.id);
    if (row.deletedAt) {
      throw errors.PLANNED_WORKOUT_DELETED({ data: { id: input.id, deletedAt: row.deletedAt } });
    }
    return plannedOf(row, today);
  }),

  delete: signedIn.plannedWorkouts.delete.handler(async ({ context, input }) =>
    deletePlanned(getDb(), context.session.user.id, input.id),
  ),

  changes: signedIn.plannedWorkouts.changes.handler(async ({ context, input }) => {
    const db = getDb();
    const userId = context.session.user.id;
    return plannedChanges(db, userId, input.since, await athleteToday(db, userId));
  }),
};

export const calendarRouter = {
  range: signedIn.calendar.range.handler(async ({ context, input }) => {
    const db = getDb();
    const userId = context.session.user.id;
    return calendarRange(db, userId, { ...input, today: await athleteToday(db, userId) });
  }),
};
