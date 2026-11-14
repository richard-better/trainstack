import { ORPCError, safe } from "@orpc/client";
import type { QueryClient } from "@tanstack/react-query";
import type { PlannedContent, PlannedWorkout } from "@trainstack/contract";
import type { Workout } from "@trainstack/workout";

import {
  type CalendarRange,
  type Placement,
  calendarKey,
  draftPlanned,
  findPlanned,
  moved,
  plannedName,
  skippedAs,
  withPlanned,
  withoutPlanned,
} from "./calendar.ts";
import type { ApiClient } from "./client.ts";
import { sameWorkout } from "./workout-save.ts";

export const plannedKey = (id: string) => ["planned", id] as const;

type Apply = (item: PlannedWorkout, today: string) => PlannedWorkout | null;

interface Pending {
  readonly seq: number;
  readonly id: string;
  readonly base: PlannedWorkout;
  readonly apply: Apply;
}

export type WriteKind = "plan" | "change" | "move" | "skip" | "delete";

export type Notice =
  | {
      readonly key: number;
      readonly kind: "overruled";
      readonly write: Exclude<WriteKind, "plan" | "delete">;
      readonly item: PlannedWorkout;
      readonly intended: Placement | null;
      readonly retry: () => void;
    }
  | { readonly key: number; readonly kind: "deleted"; readonly name: string }
  | {
      readonly key: number;
      readonly kind: "refused";
      readonly name: string;
      readonly reason: string;
    };

type NoticeInput = Notice extends infer Each
  ? Each extends Notice
    ? Omit<Each, "key">
    : never
  : never;

type Sent = PlannedWorkout | { readonly id: string; readonly deletedAt: Date };

interface Write {
  readonly kind: WriteKind;
  readonly base: PlannedWorkout;
  readonly apply: Apply;
  readonly send: (updatedAt: Date) => Promise<Sent>;
  readonly won?: (result: PlannedWorkout) => boolean;
  readonly retry?: () => void;
  readonly intended?: Placement;
}

const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export function sameContent(a: PlannedContent, b: PlannedContent) {
  if (a.kind !== b.kind || a.notes !== b.notes) return false;
  if (a.kind === "workout" && b.kind === "workout") return sameWorkout(a.workout, b.workout);
  if (a.kind === "note" && b.kind === "note") return a.title === b.title;
  return true;
}

const sameSkip = (a: PlannedWorkout["skipped"], b: PlannedWorkout["skipped"]) =>
  a === null ? b === null : b !== null && a.reason === b.reason;

const codeOf = (error: unknown) =>
  error instanceof ORPCError && error.defined ? String(error.code) : null;

function refusal(error: unknown): string | null {
  switch (codeOf(error)) {
    case "DAY_FULL":
      return "That day already holds 20 planned items.";
    case "EDITED_IN_THE_FUTURE":
      return "Your device's clock is ahead of Trainstack's. Set it to the right time and try again.";
    case "WORKOUT_TOO_LARGE":
      return "This workout is too large to plan.";
    default:
      return null;
  }
}

const isGone = (error: unknown) => {
  const code = codeOf(error);
  return code === "PLANNED_WORKOUT_DELETED" || code === "NOT_FOUND";
};

const shouldRetry = (error: unknown) => !(error instanceof ORPCError) || error.status >= 500;

export interface CalendarWritesOptions {
  readonly queryClient: QueryClient;
  readonly api: ApiClient;
  readonly retryDelays?: readonly number[];
  readonly now?: () => number;
  readonly whenOnline?: (resume: () => void) => () => void;
}

export function createCalendarWrites({
  queryClient,
  api,
  retryDelays = RETRY_DELAYS_MS,
  now = Date.now,
  whenOnline = (resume) => {
    if (typeof window === "undefined") return () => {};
    window.addEventListener("online", resume);
    return () => window.removeEventListener("online", resume);
  },
}: CalendarWritesOptions) {
  let pending: Pending[] = [];
  let notices: Notice[] = [];
  let waiting = 0;
  let seq = 0;
  let lastStamp = 0;
  let version = 0;
  const tails = new Map<string, Promise<void>>();
  const answered = new Map<string, PlannedWorkout | null>();
  const listeners = new Set<() => void>();

  function changed() {
    version += 1;
    for (const listener of listeners) listener();
  }

  function stamp() {
    lastStamp = Math.max(now(), lastStamp + 1);
    return new Date(lastStamp);
  }

  function notify(notice: NoticeInput) {
    seq += 1;
    notices = [...notices, { ...notice, key: seq }];
    changed();
  }

  async function remember(result: Sent) {
    await Promise.all([
      queryClient.cancelQueries({ queryKey: calendarKey }, { revert: false }),
      queryClient.cancelQueries(
        { queryKey: plannedKey(result.id), exact: true },
        { revert: false },
      ),
    ]);
    if ("deletedAt" in result) {
      queryClient.setQueriesData<CalendarRange>({ queryKey: calendarKey }, (range) =>
        range ? withoutPlanned(range, result.id) : range,
      );
      queryClient.removeQueries({ queryKey: plannedKey(result.id), exact: true });
    } else {
      queryClient.setQueriesData<CalendarRange>({ queryKey: calendarKey }, (range) =>
        range ? withPlanned(range, result) : range,
      );
      queryClient.setQueryData(plannedKey(result.id), result);
    }
  }

  function settleCaches() {
    void queryClient.invalidateQueries({ queryKey: calendarKey });
  }

  async function sendWithRetries(
    write: Write,
    updatedAt: Date,
  ): Promise<{ readonly result: Sent } | { readonly error: unknown }> {
    for (let attempt = 0; ; attempt++) {
      try {
        return { result: await write.send(updatedAt) } as const;
      } catch (error) {
        if (!shouldRetry(error)) return { error } as const;
      }
      waiting += 1;
      changed();
      await new Promise<void>((resolve) => {
        const delay = retryDelays[Math.min(attempt, retryDelays.length - 1)] ?? 1_000;
        let stop = () => {};
        const timer = setTimeout(() => {
          stop();
          resolve();
        }, delay);
        stop = whenOnline(() => {
          clearTimeout(timer);
          stop();
          resolve();
        });
      });
      waiting -= 1;
      changed();
    }
  }

  function run(write: Write): Promise<void> {
    seq += 1;
    const entry: Pending = { seq, id: write.base.id, base: write.base, apply: write.apply };
    pending = [...pending, entry];
    changed();
    const updatedAt = stamp();
    const previous = tails.get(entry.id) ?? Promise.resolve();
    const done = previous.then(async () => {
      const outcome = await sendWithRetries(write, updatedAt);
      if ("result" in outcome) {
        await remember(outcome.result);
        const result = outcome.result;
        answered.set(entry.id, "deletedAt" in result ? null : result);
        if (!("deletedAt" in result) && write.won && !write.won(result) && write.retry) {
          notify({
            kind: "overruled",
            write: write.kind as Exclude<WriteKind, "plan" | "delete">,
            item: result,
            intended: write.intended ?? null,
            retry: write.retry,
          });
        }
      } else if (isGone(outcome.error)) {
        await remember({ id: entry.id, deletedAt: new Date() });
        answered.set(entry.id, null);
        if (write.kind !== "delete")
          notify({ kind: "deleted", name: plannedName(write.base.content) });
      } else {
        notify({
          kind: "refused",
          name: plannedName(write.base.content),
          reason:
            refusal(outcome.error) ??
            (write.kind === "plan"
              ? "It was not planned. Try again."
              : "It was not saved. Try again."),
        });
      }
      pending = pending.filter((held) => held !== entry);
      if (!pending.some((held) => held.id === entry.id)) answered.delete(entry.id);
      changed();
      settleCaches();
    });
    tails.set(entry.id, done);
    return done;
  }

  const writes = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
    notices: () => notices,
    retrying: () => waiting > 0,
    dismiss(key: number) {
      notices = notices.filter((notice) => notice.key !== key);
      changed();
    },

    view(range: CalendarRange): CalendarRange {
      return pending.reduce((current, entry) => {
        const item =
          findPlanned(current, entry.id) ??
          (answered.has(entry.id) ? answered.get(entry.id) : entry.base);
        if (!item) return current;
        const next = entry.apply(item, current.today);
        return next ? withPlanned(current, next) : withoutPlanned(current, entry.id);
      }, range);
    },

    viewItem(item: PlannedWorkout | null, id: string, today: string): PlannedWorkout | null {
      let current = item ?? answered.get(id) ?? null;
      for (const entry of pending) {
        if (entry.id !== id) continue;
        const from = current ?? (answered.has(id) ? null : entry.base);
        current = from ? entry.apply(from, today) : null;
      }
      return current;
    },

    isPending: (id: string) => pending.some((entry) => entry.id === id),

    plan(
      input: { id: string; day: string; position: number; content: PlannedContent },
      today: string,
    ) {
      const draft = draftPlanned(input, today, new Date(now()));
      return run({
        kind: "plan",
        base: draft,
        apply: (item) => item,
        send: (updatedAt) => api.plannedWorkouts.put({ ...input, planId: null, updatedAt }),
      });
    },

    change(item: PlannedWorkout, content: PlannedContent): Promise<void> {
      return run({
        kind: "change",
        base: item,
        apply: (current) => ({ ...current, content }),
        send: (updatedAt) =>
          api.plannedWorkouts.put({
            id: item.id,
            day: item.day,
            position: item.position,
            content,
            planId: item.planId,
            updatedAt,
          }),
        won: (result) => sameContent(result.content, content),
        retry: () => void writes.change(item, content),
      });
    },

    move(item: PlannedWorkout, placement: Placement): Promise<void> {
      return run({
        kind: "move",
        base: item,
        apply: (current, today) => moved(current, placement, today),
        send: (updatedAt) => api.plannedWorkouts.move({ id: item.id, ...placement, updatedAt }),
        won: (result) => result.day === placement.day && result.position === placement.position,
        intended: placement,
        retry: () => void writes.move(item, placement),
      });
    },

    skip(item: PlannedWorkout, skipped: PlannedWorkout["skipped"]): Promise<void> {
      return run({
        kind: "skip",
        base: item,
        apply: (current, today) => skippedAs(current, skipped, today),
        send: (updatedAt) => api.plannedWorkouts.skip({ id: item.id, skipped, updatedAt }),
        won: (result) => sameSkip(result.skipped, skipped),
        retry: () => void writes.skip(item, skipped),
      });
    },

    remove(item: PlannedWorkout): Promise<void> {
      return run({
        kind: "delete",
        base: item,
        apply: () => null,
        send: () => api.plannedWorkouts.delete({ id: item.id }),
      });
    },

    remember,

    async settled() {
      while (pending.length > 0) await Promise.all(tails.values());
    },
  };
  return writes;
}

export type CalendarWrites = ReturnType<typeof createCalendarWrites>;

export type PlannedSave =
  | { readonly kind: "saved"; readonly stored: PlannedWorkout }
  | { readonly kind: "changed"; readonly stored: PlannedWorkout }
  | { readonly kind: "overruled"; readonly stored: PlannedWorkout }
  | { readonly kind: "deleted" }
  | { readonly kind: "refused"; readonly reason: string };

export async function savePlannedWorkout(
  api: ApiClient,
  request: {
    readonly base: PlannedWorkout;
    readonly workout: Workout;
    readonly overwrite: boolean;
    readonly now?: Date;
  },
): Promise<PlannedSave> {
  const { base } = request;
  const updatedAt = request.now ?? new Date();
  if (base.content.kind !== "workout") return { kind: "refused", reason: "This is not a workout." };
  const content: PlannedContent = { ...base.content, workout: request.workout };
  if (!request.overwrite) {
    const [error, current] = await safe(api.plannedWorkouts.get({ id: base.id }));
    if (error) {
      if (isGone(error)) return { kind: "deleted" };
      throw error;
    }
    if (
      current.updatedAt.getTime() > base.updatedAt.getTime() &&
      current.content.kind === "workout" &&
      !sameContent(current.content, base.content) &&
      !sameContent(current.content, content)
    ) {
      return { kind: "changed", stored: current };
    }
  }
  let stored: PlannedWorkout;
  try {
    stored = await api.plannedWorkouts.put({
      id: base.id,
      day: base.day,
      position: base.position,
      content,
      planId: base.planId,
      updatedAt,
    });
  } catch (error) {
    if (isGone(error)) return { kind: "deleted" };
    const reason = refusal(error);
    if (reason) return { kind: "refused", reason };
    throw error;
  }
  return sameContent(stored.content, content)
    ? { kind: "saved", stored }
    : { kind: "overruled", stored };
}
