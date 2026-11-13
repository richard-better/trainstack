import type { Activity } from "@trainstack/contract";

import type { ApiClient } from "./client.ts";
import {
  type CheckedFile,
  type Outcome,
  type Refusal,
  checkActivityFile,
  sendActivityFile,
} from "./upload.ts";

export type UploadState =
  | { readonly phase: "waiting" }
  | { readonly phase: "checking" }
  | { readonly phase: "refused"; readonly refusal: Refusal }
  | { readonly phase: "sending"; readonly progress: number | null }
  | { readonly phase: "done"; readonly outcome: Outcome }
  | { readonly phase: "failed" };

export interface Upload {
  readonly key: number;
  readonly name: string;
  readonly size: number;
  readonly sport: string | null;
  readonly state: UploadState;
}

export const isFinished = (upload: Upload) =>
  upload.state.phase === "refused" || upload.state.phase === "done";

export const isBusy = (upload: Upload) =>
  upload.state.phase === "waiting" ||
  upload.state.phase === "checking" ||
  upload.state.phase === "sending";

export interface UploadsOptions {
  readonly api: ApiClient;
  readonly maxBytes: number;
  readonly uploadClient?: (onProgress: (fraction: number) => void) => ApiClient;
  readonly onActivity?: (activity: Activity) => void;
  readonly concurrency?: number;
}

export interface Uploads {
  readonly list: () => readonly Upload[];
  readonly subscribe: (listener: () => void) => () => void;
  readonly add: (files: Iterable<File>) => Promise<void>;
  readonly retry: (key: number) => Promise<void>;
  readonly dismiss: (key: number) => void;
  readonly clearFinished: () => void;
  readonly clear: () => void;
}

export function createUploads({
  api,
  maxBytes,
  uploadClient = () => api,
  onActivity = () => {},
  concurrency = 3,
}: UploadsOptions): Uploads {
  let uploads: readonly Upload[] = [];
  let nextKey = 1;
  let generation = 0;
  let active = 0;
  const queue: (() => void)[] = [];
  const listeners = new Set<() => void>();
  const checked = new Map<number, CheckedFile>();
  const inFlight = new Map<string, Promise<Outcome>>();

  function update(key: number, change: Partial<Upload>) {
    uploads = uploads.map((upload) => (upload.key === key ? { ...upload, ...change } : upload));
    for (const listener of listeners) listener();
  }

  async function turn<T>(task: () => Promise<T>) {
    if (active >= concurrency) await new Promise<void>((resolve) => queue.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  }

  async function send(key: number, file: CheckedFile, started: number) {
    const current = () => started === generation;
    update(key, { state: { phase: "sending", progress: null } });
    const shared = inFlight.get(file.id);
    const sending =
      shared?.then((outcome): Outcome =>
        outcome.kind === "uploaded"
          ? { kind: "alreadyThere", activity: outcome.activity }
          : outcome,
      ) ??
      sendActivityFile(
        api,
        file,
        uploadClient((progress) => {
          if (current()) update(key, { state: { phase: "sending", progress } });
        }),
      );
    if (!shared) inFlight.set(file.id, sending);
    try {
      const outcome = await sending;
      if (!current()) return;
      checked.delete(key);
      update(key, { state: { phase: "done", outcome } });
      if (outcome.kind === "uploaded" || outcome.kind === "alreadyThere") {
        onActivity(outcome.activity);
      }
    } catch {
      if (current()) update(key, { state: { phase: "failed" } });
    } finally {
      if (!shared) inFlight.delete(file.id);
    }
  }

  async function run(key: number, file: File, started: number) {
    await turn(async () => {
      if (started !== generation || !uploads.some((upload) => upload.key === key)) return;
      update(key, { state: { phase: "checking" } });
      const check = await checkActivityFile(file, maxBytes).catch(() => null);
      if (started !== generation) return;
      if (check === null) return update(key, { state: { phase: "failed" } });
      if (check.kind !== "ready")
        return update(key, { state: { phase: "refused", refusal: check } });
      checked.set(key, check.file);
      update(key, { sport: check.file.sport });
      await send(key, check.file, started);
    });
  }

  return {
    list: () => uploads,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async add(files) {
      const started = generation;
      const added = Array.from(files, (file) => ({
        upload: {
          key: nextKey++,
          name: file.name,
          size: file.size,
          sport: null,
          state: { phase: "waiting" },
        } satisfies Upload,
        file,
      }));
      if (added.length === 0) return;
      uploads = [...added.map(({ upload }) => upload), ...uploads];
      for (const listener of listeners) listener();
      await Promise.all(added.map(({ upload, file }) => run(upload.key, file, started)));
    },
    async retry(key) {
      const file = checked.get(key);
      if (!file) return;
      const started = generation;
      update(key, { state: { phase: "waiting" } });
      await turn(() => send(key, file, started));
    },
    dismiss(key) {
      checked.delete(key);
      uploads = uploads.filter((upload) => upload.key !== key);
      for (const listener of listeners) listener();
    },
    clearFinished() {
      uploads = uploads.filter((upload) => !isFinished(upload));
      for (const listener of listeners) listener();
    },
    clear() {
      generation += 1;
      checked.clear();
      uploads = [];
      for (const listener of listeners) listener();
    },
  };
}
