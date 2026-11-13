import { ORPCError } from "@orpc/server";
import {
  MAX_WORKOUT_LIST_ENTRIES,
  type StoredWorkout,
  type WorkoutOrigin,
} from "@trainstack/contract";
import { formatOfFile, type Workout } from "@trainstack/workout";

import type { Database } from "../db";
import { signedIn } from "../procedures";
import { getDb } from "../services";
import { builtinWorkout, builtinWorkouts } from "./builtin";
import { exportedWorkout, failureData, importedWorkout } from "./files";
import {
  allLists,
  deleteList,
  findList,
  isInList,
  listChanges,
  listOf,
  liveEntryCount,
  placeInList,
  putList,
  removeFromList,
} from "./lists";
import {
  deleteWorkout,
  findWorkout,
  isEditedInTheFuture,
  isTooLarge,
  listWorkouts,
  putWorkout,
  storedOf,
  whyUnplayable,
  workoutChanges,
} from "./store";

type Written =
  | { stored: StoredWorkout }
  | { editedInTheFuture: true }
  | { tooLarge: true }
  | { unplayable: string }
  | { deletedAt: Date };

async function write(
  db: Database,
  userId: string,
  id: string,
  value: Workout,
  updatedAt: Date,
  origin: WorkoutOrigin,
): Promise<Written> {
  if (isEditedInTheFuture(updatedAt)) return { editedInTheFuture: true };
  if (isTooLarge(value)) return { tooLarge: true };
  const unplayable = whyUnplayable(value);
  if (unplayable !== undefined) return { unplayable };
  await putWorkout(db, userId, id, value, updatedAt, origin);
  const row = await findWorkout(db, userId, id);
  if (!row) throw new Error(`Workout ${id} was neither stored nor deleted`);
  if (row.deletedAt) return { deletedAt: row.deletedAt };
  return { stored: storedOf(row) };
}

export const workoutsRouter = {
  list: signedIn.workouts.list.handler(async ({ context, input }) => {
    const { limit, cursor, ...filters } = input;
    return listWorkouts(getDb(), context.session.user.id, filters, limit, cursor);
  }),

  get: signedIn.workouts.get.handler(async ({ context, input, errors }) => {
    const row = await findWorkout(getDb(), context.session.user.id, input.id);
    if (!row) throw errors.NOT_FOUND();
    if (row.deletedAt) {
      throw errors.WORKOUT_DELETED({ data: { id: row.id, deletedAt: row.deletedAt } });
    }
    return storedOf(row);
  }),

  put: signedIn.workouts.put.handler(async ({ context, input, errors }) => {
    const written = await write(
      getDb(),
      context.session.user.id,
      input.id,
      input.workout,
      input.updatedAt,
      null,
    );
    if ("stored" in written) return written.stored;
    if ("editedInTheFuture" in written) throw errors.EDITED_IN_THE_FUTURE();
    if ("tooLarge" in written) throw errors.WORKOUT_TOO_LARGE();
    if ("unplayable" in written) {
      throw errors.INVALID_WORKOUT({ data: { reason: written.unplayable } });
    }
    throw errors.WORKOUT_DELETED({ data: { id: input.id, deletedAt: written.deletedAt } });
  }),

  delete: signedIn.workouts.delete.handler(async ({ context, input }) =>
    deleteWorkout(getDb(), context.session.user.id, input.id),
  ),

  changes: signedIn.workouts.changes.handler(async ({ context, input }) =>
    workoutChanges(getDb(), context.session.user.id, input.since),
  ),

  import: signedIn.workouts.import.handler(async ({ context, input, errors }) => {
    if (!(input.file instanceof File)) {
      throw errors.WORKOUT_FORMAT_ERROR({
        data: { format: null, issues: [{ code: "unsupported", message: "No file was sent" }] },
      });
    }
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    const fileName = input.file.name;
    const imported = importedWorkout(fileName, bytes);
    if ("failure" in imported) {
      throw errors.WORKOUT_FORMAT_ERROR({ data: failureData(imported) });
    }
    const written = await write(
      getDb(),
      context.session.user.id,
      input.id,
      imported.value,
      input.updatedAt,
      { kind: "file", format: formatOfFile(fileName)!, fileName },
    );
    if ("stored" in written) return { workout: written.stored, warnings: imported.warnings };
    if ("editedInTheFuture" in written) throw errors.EDITED_IN_THE_FUTURE();
    if ("tooLarge" in written) throw errors.WORKOUT_TOO_LARGE();
    if ("unplayable" in written) {
      throw errors.INVALID_WORKOUT({ data: { reason: written.unplayable } });
    }
    throw errors.WORKOUT_DELETED({ data: { id: input.id, deletedAt: written.deletedAt } });
  }),

  export: signedIn.workouts.export.handler(async ({ context, input, errors }) => {
    const row = await findWorkout(getDb(), context.session.user.id, input.id);
    if (!row) throw errors.NOT_FOUND();
    if (row.deletedAt) {
      throw errors.WORKOUT_DELETED({ data: { id: row.id, deletedAt: row.deletedAt } });
    }
    const exported = exportedWorkout(storedOf(row).workout, input.format, input.ftp);
    if ("failure" in exported) throw errors.WORKOUT_FORMAT_ERROR({ data: failureData(exported) });
    return exported;
  }),
};

export const builtinWorkoutsRouter = {
  list: signedIn.builtinWorkouts.list.handler(({ input }) => ({
    workouts: builtinWorkouts(input),
  })),

  get: signedIn.builtinWorkouts.get.handler(({ input, errors }) => {
    const found = builtinWorkout(input.id);
    if (!found) throw errors.NOT_FOUND();
    return found;
  }),

  copy: signedIn.builtinWorkouts.copy.handler(async ({ context, input, errors }) => {
    const found = builtinWorkout(input.id);
    if (!found) throw errors.NOT_FOUND();
    const written = await write(
      getDb(),
      context.session.user.id,
      input.as,
      found.workout,
      input.updatedAt,
      { kind: "builtin", id: found.id },
    );
    if ("stored" in written) return written.stored;
    if ("editedInTheFuture" in written) throw errors.EDITED_IN_THE_FUTURE();
    if ("deletedAt" in written) {
      throw errors.WORKOUT_DELETED({ data: { id: input.as, deletedAt: written.deletedAt } });
    }
    throw new Error(`Built-in workout ${found.id} does not fit the library`);
  }),

  export: signedIn.builtinWorkouts.export.handler(({ input, errors }) => {
    const found = builtinWorkout(input.id);
    if (!found) throw errors.NOT_FOUND();
    const exported = exportedWorkout(found.workout, input.format, input.ftp);
    if ("failure" in exported) throw errors.WORKOUT_FORMAT_ERROR({ data: failureData(exported) });
    return exported;
  }),
};

export const workoutListsRouter = {
  list: signedIn.workoutLists.list.handler(async ({ context }) => ({
    lists: await allLists(getDb(), context.session.user.id),
  })),

  get: signedIn.workoutLists.get.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const row = await findList(db, userId, input.id);
    if (!row) throw errors.NOT_FOUND();
    if (row.deletedAt)
      throw errors.LIST_DELETED({ data: { id: row.id, deletedAt: row.deletedAt } });
    return listOf(db, userId, row);
  }),

  put: signedIn.workoutLists.put.handler(async ({ context, input, errors }) => {
    if (isEditedInTheFuture(input.updatedAt)) throw errors.EDITED_IN_THE_FUTURE();
    const db = getDb();
    const userId = context.session.user.id;
    await putList(db, userId, input.id, input.name, input.updatedAt);
    const row = await findList(db, userId, input.id);
    if (!row) throw new Error(`List ${input.id} was neither stored nor deleted`);
    if (row.deletedAt)
      throw errors.LIST_DELETED({ data: { id: row.id, deletedAt: row.deletedAt } });
    return listOf(db, userId, row);
  }),

  delete: signedIn.workoutLists.delete.handler(async ({ context, input }) =>
    deleteList(getDb(), context.session.user.id, input.id),
  ),

  place: signedIn.workoutLists.place.handler(async ({ context, input, errors }) => {
    if (isEditedInTheFuture(input.updatedAt)) throw errors.EDITED_IN_THE_FUTURE();
    if (input.after === input.workoutId) {
      throw new ORPCError("BAD_REQUEST", { message: "A workout cannot follow itself" });
    }
    const db = getDb();
    const userId = context.session.user.id;
    const list = await findList(db, userId, input.id);
    if (!list) throw errors.NOT_FOUND({ message: "No such list" });
    if (list.deletedAt) {
      throw errors.LIST_DELETED({ data: { id: list.id, deletedAt: list.deletedAt } });
    }
    const workout = await findWorkout(db, userId, input.workoutId);
    if (!workout) throw errors.NOT_FOUND({ message: "No such workout" });
    if (workout.deletedAt) {
      throw errors.WORKOUT_DELETED({ data: { id: workout.id, deletedAt: workout.deletedAt } });
    }
    if (
      !(await isInList(db, userId, list.id, workout.id)) &&
      (await liveEntryCount(db, userId, list.id)) >= MAX_WORKOUT_LIST_ENTRIES
    ) {
      throw errors.LIST_FULL();
    }
    await placeInList(db, userId, {
      listId: list.id,
      workoutId: workout.id,
      after: input.after,
      updatedAt: input.updatedAt,
    });
    return listOf(db, userId, list);
  }),

  remove: signedIn.workoutLists.remove.handler(async ({ context, input, errors }) => {
    if (isEditedInTheFuture(input.updatedAt)) throw errors.EDITED_IN_THE_FUTURE();
    const db = getDb();
    const userId = context.session.user.id;
    const list = await findList(db, userId, input.id);
    if (!list) throw errors.NOT_FOUND();
    if (list.deletedAt) {
      throw errors.LIST_DELETED({ data: { id: list.id, deletedAt: list.deletedAt } });
    }
    if (await findWorkout(db, userId, input.workoutId)) {
      await removeFromList(db, userId, {
        listId: list.id,
        workoutId: input.workoutId,
        updatedAt: input.updatedAt,
      });
    }
    return listOf(db, userId, list);
  }),

  changes: signedIn.workoutLists.changes.handler(async ({ context, input }) =>
    listChanges(getDb(), context.session.user.id, input.since),
  ),
};
