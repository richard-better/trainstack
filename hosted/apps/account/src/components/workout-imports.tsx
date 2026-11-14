import { MAX_WORKOUT_FILE_BYTES, type StoredWorkout } from "@trainstack/contract";
import type { FormatIssue } from "@trainstack/workout";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { api } from "../api";
import {
  type FileReading,
  importWorkoutFile,
  readWorkoutFile,
  WORKOUT_FILE_TYPES,
} from "../lib/library";
import { formatMinutes, overviewOf, sportNames } from "../lib/workout-profile";
import { FileDropTarget } from "./uploads";
import { WorkoutThumb } from "./workout-chart";
import { rememberWorkout, useReference } from "./workout-data";

type Item =
  | { readonly key: string; readonly phase: "reading"; readonly file: File }
  | { readonly key: string; readonly phase: "read"; readonly reading: FileReading }
  | {
      readonly key: string;
      readonly phase: "saving";
      readonly reading: Extract<FileReading, { kind: "ready" }>;
    }
  | {
      readonly key: string;
      readonly phase: "saved";
      readonly workout: StoredWorkout;
      readonly warnings: readonly FormatIssue[];
    }
  | {
      readonly key: string;
      readonly phase: "failed";
      readonly reading: Extract<FileReading, { kind: "ready" }>;
      readonly issues: readonly FormatIssue[] | null;
    };

const sizeLimit = `${MAX_WORKOUT_FILE_BYTES / 1024 / 1024} MB`;

export function useWorkoutImports() {
  const [items, setItems] = useState<Item[]>([]);
  const stamps = useRef(new Map<string, Date>());
  const replace = (key: string, item: Item) =>
    setItems((current) => current.map((held) => (held.key === key ? item : held)));

  async function add(files: readonly File[]) {
    const added = files.map((file) => ({
      key: crypto.randomUUID(),
      phase: "reading" as const,
      file,
    }));
    setItems((current) => [...added, ...current]);
    for (const item of added) {
      const reading = await readWorkoutFile(item.file, MAX_WORKOUT_FILE_BYTES).catch(
        (): FileReading => ({
          kind: "refused",
          file: item.file,
          issues: [{ code: "malformed", message: "The file could not be read." }],
        }),
      );
      replace(item.key, { key: item.key, phase: "read", reading });
    }
  }

  async function save(key: string, reading: Extract<FileReading, { kind: "ready" }>) {
    replace(key, { key, phase: "saving", reading });
    const updatedAt = stamps.current.get(key) ?? new Date();
    stamps.current.set(key, updatedAt);
    try {
      const imported = await importWorkoutFile(api, reading.file, key, updatedAt);
      if (imported.kind === "saved") {
        await rememberWorkout(imported.workout);
        replace(key, {
          key,
          phase: "saved",
          workout: imported.workout,
          warnings: imported.warnings,
        });
      } else {
        replace(key, { key, phase: "failed", reading, issues: imported.issues });
      }
    } catch {
      replace(key, { key, phase: "failed", reading, issues: null });
    }
  }

  const dismiss = (key: string) =>
    setItems((current) => current.filter((item) => item.key !== key));

  return { items, add, save, dismiss };
}

export type WorkoutImports = ReturnType<typeof useWorkoutImports>;

export function ImportButton({ imports }: { imports: WorkoutImports }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="secondary" onClick={() => input.current?.click()}>
        Import files
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={WORKOUT_FILE_TYPES}
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          void imports.add(files);
        }}
      />
    </>
  );
}

export function ImportDropTarget({ imports }: { imports: WorkoutImports }) {
  return (
    <FileDropTarget
      title="Drop to import"
      detail={`.zwo, .erg and .mrc workouts, up to ${sizeLimit} each`}
      onFiles={(files) => void imports.add(files)}
    />
  );
}

export function ImportList({ imports }: { imports: WorkoutImports }) {
  if (imports.items.length === 0) return null;
  return (
    <section className="imports" aria-label="Imports">
      <ol className="import-list">
        {imports.items.map((item) => (
          <li key={item.key}>
            <ImportItem item={item} imports={imports} />
          </li>
        ))}
      </ol>
    </section>
  );
}

export function FormatIssues({ issues, title }: { issues: readonly FormatIssue[]; title: string }) {
  if (issues.length === 0) return null;
  return (
    <div className="issues">
      <p className="issues-title">{title}</p>
      <ul>
        {issues.map((issue, index) => (
          <li key={index}>{issue.message}</li>
        ))}
      </ul>
    </div>
  );
}

function ImportItem({ item, imports }: { item: Item; imports: WorkoutImports }) {
  const dismiss = (
    <button
      type="button"
      className="quiet compact"
      disabled={item.phase === "saving"}
      onClick={() => imports.dismiss(item.key)}
    >
      {item.phase === "saved" ? "Done" : "Cancel"}
    </button>
  );
  if (item.phase === "reading") {
    return (
      <div className="import-card" aria-busy="true">
        <p className="import-name">{item.file.name}</p>
        <p className="lede">Reading…</p>
      </div>
    );
  }
  if (item.phase === "saved") {
    return (
      <div className="import-card saved" role="status">
        <p className="import-name">
          <Link to="/workouts/$id" params={{ id: item.workout.id }} className="text-link">
            {item.workout.name}
          </Link>{" "}
          is in your workouts.
        </p>
        <FormatIssues issues={item.warnings} title="Left out of the file:" />
        <div className="import-actions">{dismiss}</div>
      </div>
    );
  }
  const reading = item.reading;
  if (reading.kind === "refused") {
    return (
      <div className="import-card refused" role="alert">
        <p className="import-name">{reading.file.name} cannot be imported.</p>
        <FormatIssues issues={reading.issues} title="What is wrong:" />
        <div className="import-actions">{dismiss}</div>
      </div>
    );
  }
  return (
    <ReadyItem
      item={item as Extract<Item, { reading: { kind: "ready" } }>}
      reading={reading}
      dismiss={dismiss}
      imports={imports}
    />
  );
}

function ReadyItem({
  item,
  reading,
  dismiss,
  imports,
}: {
  item: Item;
  reading: Extract<FileReading, { kind: "ready" }>;
  dismiss: React.ReactNode;
  imports: WorkoutImports;
}) {
  const { reference } = useReference(reading.workout.sport);
  const overview = overviewOf(reading.workout, reference);
  const saving = item.phase === "saving";
  return (
    <div className="import-card" aria-busy={saving}>
      <div className="import-preview">
        <WorkoutThumb overview={overview} />
        <div>
          <p className="import-name">{reading.workout.name}</p>
          <p className="row-meta">
            <span>{sportNames[reading.workout.sport]}</span>
            <span>
              {overview.estimated ? "about " : ""}
              {formatMinutes(overview.seconds)}
            </span>
            <span>{reading.file.name}</span>
          </p>
        </div>
      </div>
      <FormatIssues issues={reading.warnings} title="Trainstack will leave out:" />
      {item.phase === "failed" && (
        <p role="alert" className="notice">
          {item.issues ? "The server refused this file." : "The workout was not saved. Try again."}
        </p>
      )}
      {item.phase === "failed" && item.issues && (
        <FormatIssues issues={item.issues} title="What is wrong:" />
      )}
      <div className="import-actions">
        {dismiss}
        <button
          type="button"
          className="primary compact"
          disabled={saving}
          onClick={() => void imports.save(item.key, reading)}
        >
          {saving ? "Saving…" : "Add to my workouts"}
        </button>
      </div>
    </div>
  );
}
