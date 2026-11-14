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
  pairedAs,
  plannedName,
  skippedAs,
  withPlanned,
  withoutPlanned,
} from "./calendar.ts";
import type { ApiClient } from "./client.ts";
import { readinessKey } from "./readiness.ts";
import { sameWorkout } from "./workout-save.ts";

export const plannedKey = (id: string) => ["planned", id] as const;

type Apply = (item: PlannedWorkout, today: string) => PlannedWorkout | null;

interface Pending {
  readonly seq: number;
  readonly id: string;
  readonly base: PlannedWorkout;
  readonly apply: Apply;
  readonly choice?: PairingChoice;
}

interface PairingChoice {
  readonly activityId: string;
  readonly paired: boolean;
}

export type WriteKind = "plan" | "change" | "move" | "skip" | "pair" | "unpair" | "delete";

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
  readonly choice?: PairingChoice;
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
    case "NOT_PAIRABLE":
      return "Only a workout pairs, and only with an activity of its own day.";
    case "ACTIVITY_NOT_FOUND":
      return "That activity is no longer in your account.";
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
  const tails = new Map<string, Promise<unknown>>();
  const answered = new Map<string, PlannedWorkout | null>();
  const latestChoice = new Map<string, number>();
  const sleepers = new Set<() => void>();
  let epoch = 0;
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
    void queryClient.invalidateQueries({ queryKey: readinessKey });
  }

  function settleCaches() {
    void queryClient.invalidateQueries({ queryKey: calendarKey });
    void queryClient.invalidateQueries({ queryKey: ["planned"] });
  }

  async function sendWithRetries(
    write: Write,
    updatedAt: Date,
    queuedIn: number,
  ): Promise<{ readonly result: Sent } | { readonly error: unknown } | { readonly dropped: true }> {
    for (let attempt = 0; ; attempt++) {
      if (queuedIn !== epoch) return { dropped: true } as const;
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
        const wake = () => {
          clearTimeout(timer);
          stop();
          sleepers.delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, delay);
        stop = whenOnline(wake);
        sleepers.add(wake);
      });
      waiting -= 1;
      changed();
    }
  }

  function run(write: Write): Promise<boolean> {
    seq += 1;
    const entry: Pending = {
      seq,
      id: write.base.id,
      base: write.base,
      apply: write.apply,
      ...(write.choice ? { choice: write.choice } : {}),
    };
    pending = [...pending, entry];
    changed();
    const updatedAt = stamp();
    const queuedIn = epoch;
    const previous = tails.get(entry.id) ?? Promise.resolve();
    const done = previous.then(async () => {
      const outcome = await sendWithRetries(write, updatedAt, queuedIn);
      if ("dropped" in outcome || queuedIn !== epoch) return false;
      if ("result" in outcome) {
        await remember(outcome.result);
        const result = outcome.result;
        answered.set(entry.id, "deletedAt" in result ? null : result);
        if (entry.choice) {
          const { activityId } = entry.choice;
          latestChoice.set(activityId, Math.max(latestChoice.get(activityId) ?? 0, entry.seq));
        }
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
        if (write.kind === "plan") answered.set(entry.id, null);
        else if (!answered.has(entry.id)) answered.set(entry.id, write.base);
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
      for (const activityId of latestChoice.keys()) {
        if (!pending.some((held) => held.choice?.activityId === activityId)) {
          latestChoice.delete(activityId);
        }
      }
      changed();
      settleCaches();
      return "result" in outcome;
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
      const ids = [...new Set(pending.map((entry) => entry.id))];
      const folded = ids.reduce((current, id) => {
        const next = writes.viewItem(findPlanned(current, id), id, current.today);
        return next ? withPlanned(current, next) : withoutPlanned(current, id);
      }, range);
      return pending.reduce((current, { seq, id, base, choice }) => {
        const chooser = choice && findPlanned(current, id);
        if (!choice || !chooser || chooser.day !== base.day) return current;
        const { activityId, paired } = choice;
        const overtaken = (latestChoice.get(activityId) ?? 0) > seq;
        if (!paired || overtaken) {
          if (overtaken && !paired) return current;
          return chooser.pairing?.activityId === activityId
            ? withPlanned(current, pairedAs(chooser, null, current.today))
            : current;
        }
        const day = current.days.find((held) => held.day === chooser.day);
        const displaced = (day?.planned ?? []).filter(
          (other) => other.id !== id && other.pairing?.activityId === activityId,
        );
        return displaced.reduce(
          (next, other) => withPlanned(next, pairedAs(other, null, next.today)),
          withPlanned(current, pairedAs(chooser, activityId, current.today)),
        );
      }, folded);
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

    clear() {
      epoch += 1;
      pending = [];
      notices = [];
      answered.clear();
      latestChoice.clear();
      tails.clear();
      for (const wake of sleepers) wake();
      changed();
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

    change(item: PlannedWorkout, content: PlannedContent): Promise<boolean> {
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

    move(item: PlannedWorkout, placement: Placement): Promise<boolean> {
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

    skip(item: PlannedWorkout, skipped: PlannedWorkout["skipped"]): Promise<boolean> {
      return run({
        kind: "skip",
        base: item,
        apply: (current, today) => skippedAs(current, skipped, today),
        send: (updatedAt) => api.plannedWorkouts.skip({ id: item.id, skipped, updatedAt }),
        won: (result) => sameSkip(result.skipped, skipped),
        retry: () => void writes.skip(item, skipped),
      });
    },

    pair(item: PlannedWorkout, activityId: string): Promise<boolean> {
      return run({
        kind: "pair",
        base: item,
        apply: (current, today) => pairedAs(current, activityId, today),
        send: (updatedAt) => api.plannedWorkouts.pair({ id: item.id, activityId, updatedAt }),
        won: (result) => result.pairing?.activityId === activityId,
        retry: () => void writes.pair(item, activityId),
        choice: { activityId, paired: true },
      });
    },

    unpair(item: PlannedWorkout, activityId: string): Promise<boolean> {
      return run({
        kind: "unpair",
        base: item,
        apply: (current, today) =>
          current.pairing?.activityId === activityId ? pairedAs(current, null, today) : current,
        send: (updatedAt) => api.plannedWorkouts.unpair({ id: item.id, activityId, updatedAt }),
        won: (result) => result.pairing?.activityId !== activityId,
        retry: () => void writes.unpair(item, activityId),
        choice: { activityId, paired: false },
      });
    },

    remove(item: PlannedWorkout): Promise<boolean> {
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
    if (current.content.kind !== "workout") {
      return {
        kind: "refused",
        reason: `It became ${current.content.kind === "note" ? "a note" : "a rest day"} on another device, so your changes were not saved over it.`,
      };
    }
    if (!sameContent(current.content, base.content) && !sameContent(current.content, content)) {
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
