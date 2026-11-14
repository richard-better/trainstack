import { isDefinedError, safe } from "@orpc/client";
import type { QueryClient } from "@tanstack/react-query";
import type {
  ExportedWorkout,
  StoredWorkout,
  WorkoutList,
  WorkoutSummary,
} from "@trainstack/contract";
import {
  type FormatIssue,
  type Workout,
  type WorkoutFormat,
  WorkoutFormatError,
  formatOfFile,
  parseWorkoutFile,
  workoutFormats,
} from "@trainstack/workout";

import type { ApiClient } from "./client.ts";

export type Library = {
  readonly workouts: Readonly<Record<string, StoredWorkout>>;
  readonly cursor: string | undefined;
};

export const emptyLibrary: Library = { workouts: {}, cursor: undefined };

type Changes = Awaited<ReturnType<ApiClient["workouts"]["changes"]>>;

export function withChanges(library: Library, changes: Changes): Library {
  const workouts = { ...library.workouts };
  for (const workout of changes.workouts) {
    const held = workouts[workout.id];
    if (!held || held.updatedAt.getTime() <= workout.updatedAt.getTime()) {
      workouts[workout.id] = workout;
    }
  }
  for (const deletion of changes.deleted) delete workouts[deletion.id];
  return { workouts, cursor: changes.cursor };
}

export function withWorkout(library: Library, workout: StoredWorkout): Library {
  return { ...library, workouts: { ...library.workouts, [workout.id]: workout } };
}

export function withoutWorkout(library: Library, id: string): Library {
  const workouts = { ...library.workouts };
  delete workouts[id];
  return { ...library, workouts };
}

export async function refreshLibrary(api: ApiClient, library: Library): Promise<Library> {
  const changes = await api.workouts.changes(library.cursor ? { since: library.cursor } : {});
  return withChanges(library, changes);
}

async function writeLibrary(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  change: (library: Library) => Library,
) {
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData<Library>(queryKey, (library) => change(library ?? emptyLibrary));
  void queryClient.invalidateQueries({ queryKey, exact: true });
}

export const rememberIn = (
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  workout: StoredWorkout,
) => writeLibrary(queryClient, queryKey, (library) => withWorkout(library, workout));

export const forgetIn = (queryClient: QueryClient, queryKey: readonly unknown[], id: string) =>
  writeLibrary(queryClient, queryKey, (library) => withoutWorkout(library, id));

export const isBehind = (library: Library, summaries: readonly WorkoutSummary[]) =>
  summaries.some((summary) => {
    const held = library.workouts[summary.id];
    return !held || held.updatedAt.getTime() < summary.updatedAt.getTime();
  });

export type DurationBucket = "short" | "medium" | "long";

export const durationBuckets: Record<
  DurationBucket,
  { label: string; min?: number; max?: number }
> = {
  short: { label: "Under 45 min", max: 45 * 60 - 1 },
  medium: { label: "45-75 min", min: 45 * 60, max: 75 * 60 },
  long: { label: "Over 75 min", min: 75 * 60 + 1 },
};

export function durationFilter(bucket: DurationBucket | undefined) {
  if (!bucket) return {};
  const { min, max } = durationBuckets[bucket];
  return {
    ...(min === undefined ? {} : { minSeconds: min }),
    ...(max === undefined ? {} : { maxSeconds: max }),
  };
}

export function placementFor(ids: readonly string[], from: number, to: number) {
  const workoutId = ids[from];
  if (workoutId === undefined || to < 0 || to >= ids.length || to === from) return null;
  const rest = ids.filter((_, index) => index !== from);
  const after = to === 0 ? null : rest[to - 1]!;
  return { workoutId, after };
}

type Lists = { lists: WorkoutList[] };

type ListChange = (list: WorkoutList) => WorkoutList;

type ListQueue = { tail: Promise<unknown>; pending: ListChange[] };

const queues = new WeakMap<QueryClient, Map<string, ListQueue>>();

function setList(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  id: string,
  change: ListChange,
) {
  queryClient.setQueryData<Lists>(queryKey, (data) =>
    data ? { lists: data.lists.map((list) => (list.id === id ? change(list) : list)) } : data,
  );
}

function queuesOf(queryClient: QueryClient, queryKey: readonly unknown[]) {
  const known = queues.get(queryClient);
  if (known) return known;
  const byList = new Map<string, ListQueue>();
  queues.set(queryClient, byList);
  const key = JSON.stringify(queryKey);
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success" || event.action.manual) return;
    if (JSON.stringify(event.query.queryKey) !== key) return;
    for (const [id, queue] of byList) {
      for (const change of queue.pending) setList(queryClient, queryKey, id, change);
    }
  });
  return byList;
}

export function queueListWrite(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  id: string,
  optimistic: ListChange,
  send: () => Promise<WorkoutList>,
): Promise<WorkoutList> {
  const byList = queuesOf(queryClient, queryKey);
  const queue: ListQueue = byList.get(id) ?? { tail: Promise.resolve(), pending: [] };
  byList.set(id, queue);
  setList(queryClient, queryKey, id, optimistic);
  queue.pending.push(optimistic);
  const settle = async () => {
    queue.pending.splice(queue.pending.indexOf(optimistic), 1);
    if (queue.pending.length > 0) return false;
    await queryClient.cancelQueries({ queryKey, exact: true }, { revert: false });
    return true;
  };
  const written = queue.tail.then(send).then(
    async (answer: WorkoutList) => {
      if (await settle()) {
        setList(queryClient, queryKey, id, () => answer);
        void queryClient.invalidateQueries({ queryKey, exact: true });
      }
      return answer;
    },
    async (error: unknown) => {
      await settle();
      void queryClient.invalidateQueries({ queryKey, exact: true });
      throw error;
    },
  );
  queue.tail = written.catch(() => undefined);
  return written;
}

export const appendedTo = (list: WorkoutList, workoutId: string) => ({
  workoutId,
  after: list.workoutIds.filter((id) => id !== workoutId).at(-1) ?? null,
});

export function listsHolding(lists: readonly WorkoutList[], workoutId: string) {
  return lists.filter((list) => list.workoutIds.includes(workoutId)).map((list) => list.id);
}

export type FileReading =
  | {
      readonly kind: "ready";
      readonly file: File;
      readonly format: WorkoutFormat;
      readonly workout: Workout;
      readonly warnings: readonly FormatIssue[];
    }
  | { readonly kind: "refused"; readonly file: File; readonly issues: readonly FormatIssue[] };

export const WORKOUT_FILE_TYPES = workoutFormats.map((format) => `.${format}`).join(",");

export async function readWorkoutFile(file: File, maxBytes: number): Promise<FileReading> {
  const format = formatOfFile(file.name);
  if (!format) {
    return {
      kind: "refused",
      file,
      issues: [{ code: "unsupported", message: "Choose a .zwo, .erg or .mrc file." }],
    };
  }
  if (file.size > maxBytes) {
    return {
      kind: "refused",
      file,
      issues: [
        {
          code: "unsupported",
          message: `The file is ${Math.ceil(file.size / 1024)} KB. A workout file can be at most ${maxBytes / 1024} KB.`,
        },
      ],
    };
  }
  try {
    const { value, warnings } = parseWorkoutFile(file.name, await file.text());
    return { kind: "ready", file, format, workout: value, warnings };
  } catch (error) {
    if (error instanceof WorkoutFormatError) return { kind: "refused", file, issues: error.issues };
    throw error;
  }
}

export type Imported =
  | {
      readonly kind: "saved";
      readonly workout: StoredWorkout;
      readonly warnings: readonly FormatIssue[];
    }
  | { readonly kind: "refused"; readonly issues: readonly FormatIssue[] };

export async function importWorkoutFile(
  api: ApiClient,
  file: File,
  id: string = crypto.randomUUID(),
  updatedAt: Date = new Date(),
): Promise<Imported> {
  const [error, result] = await safe(api.workouts.import({ file, id, updatedAt }));
  if (!error) return { kind: "saved", workout: result.workout, warnings: result.warnings };
  if (isDefinedError(error) && error.code === "WORKOUT_FORMAT_ERROR") {
    return { kind: "refused", issues: error.data.issues };
  }
  if (isDefinedError(error) && error.code === "WORKOUT_TOO_LARGE") {
    return { kind: "refused", issues: [{ code: "unsupported", message: error.message }] };
  }
  throw error;
}

export type WorkoutSource =
  | { readonly kind: "own"; readonly id: string }
  | { readonly kind: "builtin"; readonly id: string };

export type Exported =
  | { readonly kind: "file"; readonly file: ExportedWorkout }
  | { readonly kind: "refused"; readonly issues: readonly FormatIssue[] };

export async function exportWorkout(
  api: ApiClient,
  source: WorkoutSource,
  format: WorkoutFormat,
  ftp: number | null,
): Promise<Exported> {
  const input = { id: source.id, format, ...(ftp === null ? {} : { ftp }) };
  const [error, file] = await safe(
    source.kind === "own" ? api.workouts.export(input) : api.builtinWorkouts.export(input),
  );
  if (!error) return { kind: "file", file };
  if (isDefinedError(error) && error.code === "WORKOUT_FORMAT_ERROR") {
    return { kind: "refused", issues: error.data.issues };
  }
  throw error;
}

export const formatNames: Record<WorkoutFormat, string> = {
  zwo: "Zwift (.zwo)",
  erg: "ERG (.erg)",
  mrc: "MRC (.mrc)",
};
