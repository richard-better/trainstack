import { ORPCError } from "@orpc/client";
import { type ExportedWorkout, type StoredWorkout, workoutIdSchema } from "@trainstack/contract";
import { type Workout, type WorkoutFileFormat, workoutFileFormats } from "@trainstack/workout";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { api, queryClient } from "../api";
import { type Exported, exportedBytes, exportWorkout, type WorkoutSource } from "../lib/library";
import { sportName } from "../lib/sports";
import {
  focusNames,
  formatMeters,
  formatSpan,
  lapStepsText,
  type Overview,
  overviewOf,
  type Reference,
  sportNames,
} from "../lib/workout-profile";
import { SportIcon } from "./sport-icon";
import { useHighlight, WorkoutChart } from "./workout-chart";
import {
  forgetWorkout,
  rememberWorkout,
  useBuiltin,
  useLibrary,
  useReference,
} from "./workout-data";
import { FormatIssues } from "./workout-imports";
import { AddToList } from "./workout-lists";
import { WorkoutSteps } from "./workout-steps";

const refused = (error: Error) => error instanceof ORPCError && error.status < 500;

export const workoutKey = (id: string) => ["workout", id] as const;

export function useStoredWorkout(id: string) {
  const library = useLibrary();
  const valid = workoutIdSchema.safeParse(id).success;
  const held = library.data?.workouts[id];
  const fetched = useQuery({
    queryKey: workoutKey(id),
    queryFn: () => api.workouts.get({ id }),
    enabled: valid && library.isFetched && !held,
    retry: (failures, error) => !refused(error) && failures < 2,
  });
  return { valid, workout: held ?? fetched.data, query: fetched };
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="content detail">
      <Link to="/workouts" search={{}} className="back">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            d="M10 3 5 8l5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Workouts
      </Link>
      {children}
    </main>
  );
}

function Missing({ title, lede }: { title: string; lede: string }) {
  return (
    <Shell>
      <div className="state" role="alert">
        <p className="state-title">{title}</p>
        <p className="lede">{lede}</p>
        <Link to="/workouts" search={{}} className="secondary link-button">
          See your workouts
        </Link>
      </div>
    </Shell>
  );
}

function Loading() {
  return (
    <Shell>
      <div className="detail-head skeleton" aria-busy="true" aria-label="Loading workout">
        <span className="bar" style={{ width: "30%" }} />
        <span className="bar tall" style={{ width: "55%" }} />
      </div>
      <div className="traces-loading" />
    </Shell>
  );
}

export function OwnWorkoutPage({ id }: { id: string }) {
  const { valid, workout, query } = useStoredWorkout(id);
  const error = query.error;
  if (
    !valid ||
    (error instanceof ORPCError && (error.code === "NOT_FOUND" || error.code === "WORKOUT_DELETED"))
  ) {
    return (
      <Missing
        title={
          error instanceof ORPCError && error.code === "WORKOUT_DELETED"
            ? "This workout was deleted."
            : "This workout is not in your account."
        }
        lede="It may have been deleted on another device, or the link belongs to someone else's account."
      />
    );
  }
  if (workout) {
    return (
      <WorkoutView
        source={{ kind: "own", id }}
        workout={workout.workout}
        stored={workout}
        actions={<OwnActions stored={workout} />}
      />
    );
  }
  if (query.isError) {
    return (
      <Shell>
        <div className="state" role="alert">
          <p className="state-title">This workout did not load.</p>
          <p className="lede">Check your connection and try again.</p>
          <button type="button" className="secondary" onClick={() => query.refetch()}>
            Try again
          </button>
        </div>
      </Shell>
    );
  }
  return <Loading />;
}

export function BuiltinWorkoutPage({
  id,
  onCopied,
}: {
  id: string;
  onCopied?: (copy: StoredWorkout) => void;
}) {
  const builtin = useBuiltin(id);
  if (builtin.isError && builtin.error instanceof ORPCError && builtin.error.code === "NOT_FOUND") {
    return (
      <Missing title="There is no such built-in workout." lede="It may have left the library." />
    );
  }
  if (builtin.isError) {
    return (
      <Shell>
        <div className="state" role="alert">
          <p className="state-title">This workout did not load.</p>
          <button type="button" className="secondary" onClick={() => builtin.refetch()}>
            Try again
          </button>
        </div>
      </Shell>
    );
  }
  if (builtin.isPending) return <Loading />;
  return (
    <WorkoutView
      source={{ kind: "builtin", id }}
      workout={builtin.data.workout}
      stored={null}
      actions={<CopyButton id={id} onCopied={onCopied} />}
    />
  );
}

function CopyButton({
  id,
  onCopied,
}: {
  id: string;
  onCopied?: ((copy: StoredWorkout) => void) | undefined;
}) {
  const navigate = useNavigate();
  const attempt = useRef<{ as: string; updatedAt: Date } | null>(null);
  const copy = useMutation({
    mutationFn: () => {
      attempt.current ??= { as: crypto.randomUUID(), updatedAt: new Date() };
      return api.builtinWorkouts.copy({ id, ...attempt.current });
    },
    onSuccess: async (copied) => {
      attempt.current = null;
      await rememberWorkout(copied);
      if (onCopied) onCopied(copied);
      else await navigate({ to: "/workouts/$id/edit", params: { id: copied.id } });
    },
  });
  return (
    <>
      <button
        type="button"
        className="primary"
        onClick={() => copy.mutate()}
        disabled={copy.isPending}
      >
        {copy.isPending ? "Copying…" : "Copy and edit"}
      </button>
      {copy.isError && (
        <p role="alert" className="notice">
          The workout was not copied. Try again.
        </p>
      )}
    </>
  );
}

function OwnActions({ stored }: { stored: StoredWorkout }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => api.workouts.delete({ id: stored.id }),
    onSuccess: async () => {
      dialog.current?.close();
      await forgetWorkout(stored.id);
      queryClient.removeQueries({ queryKey: workoutKey(stored.id) });
      await navigate({ to: "/workouts", search: {} });
    },
  });
  return (
    <>
      <Link to="/workouts/$id/edit" params={{ id: stored.id }} className="primary link-button">
        Edit
      </Link>
      <AddToList workoutId={stored.id} />
      <button
        type="button"
        className="secondary danger"
        onClick={() => dialog.current?.showModal()}
      >
        Delete
      </button>
      <dialog
        ref={dialog}
        className="confirm"
        aria-labelledby="delete-workout-title"
        onClose={() => remove.reset()}
      >
        <h2 id="delete-workout-title">Delete {stored.name}?</h2>
        <p className="lede">
          It goes from your library and every list, on every device. A deleted workout cannot be
          brought back.
        </p>
        {remove.isError && (
          <p role="alert" className="notice">
            The workout was not deleted. Try again.
          </p>
        )}
        <div className="confirm-actions">
          <button
            type="button"
            className="secondary"
            autoFocus
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button
            type="button"
            className="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? "Deleting…" : "Delete workout"}
          </button>
        </div>
      </dialog>
    </>
  );
}

function originText(stored: StoredWorkout | null) {
  const origin = stored?.origin;
  if (!origin) return null;
  return origin.kind === "builtin"
    ? "Copied from a built-in workout"
    : `Imported from ${origin.fileName}`;
}

export function WorkoutView({
  source,
  workout,
  stored,
  actions,
}: {
  source: WorkoutSource;
  workout: Workout;
  stored: StoredWorkout | null;
  actions: ReactNode;
}) {
  const { reference } = useReference(workout.sport);
  const overview = overviewOf(workout, reference);
  const { highlight, setHighlight } = useHighlight();

  useEffect(() => {
    document.title = `${workout.name} - Trainstack`;
    return () => {
      document.title = "Trainstack";
    };
  }, [workout.name]);

  return (
    <Shell>
      <header className="detail-head">
        <p className="detail-meta">
          <span className="detail-sport">
            <SportIcon family={sportName(workout.sport).family} />
            {sportNames[workout.sport]}
          </span>
          {workout.focus && <span>{focusNames[workout.focus]}</span>}
          {source.kind === "builtin" && <span>Built-in</span>}
          {workout.author && <span>By {workout.author}</span>}
          {originText(stored) && <span>{originText(stored)}</span>}
        </p>
        <h1 className="detail-title">{workout.name}</h1>
        <div className="actions">{actions}</div>
      </header>

      <WorkoutFigures overview={overview} reference={reference} />

      <section aria-labelledby="profile-title" className="workout-section">
        <h2 id="profile-title" className="section-title">
          Profile
        </h2>
        <WorkoutChart
          overview={overview}
          reference={reference}
          highlight={highlight}
          onHighlight={setHighlight}
          title={workout.name}
        />
        <ReferenceNote overview={overview} reference={reference} />
      </section>

      <div className="workout-columns">
        <section aria-labelledby="steps-title">
          <h2 id="steps-title" className="section-title">
            Steps
          </h2>
          <WorkoutSteps
            workout={workout}
            overview={overview}
            reference={reference}
            highlight={highlight}
            onHighlight={setHighlight}
          />
        </section>
        <aside className="workout-aside">
          {workout.description && (
            <section aria-labelledby="about-title">
              <h2 id="about-title" className="section-title">
                About
              </h2>
              <p className="workout-description">{workout.description}</p>
            </section>
          )}
          {workout.tags && workout.tags.length > 0 && (
            <ul className="tags" aria-label="Tags">
              {workout.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}
          <ExportSection source={source} name={workout.name} ftp={reference.ftp} />
        </aside>
      </div>
    </Shell>
  );
}

function WorkoutFigures({ overview, reference }: { overview: Overview; reference: Reference }) {
  const figures: { label: string; value: string; unit?: string; note?: string }[] = [
    {
      label: overview.estimated ? "Duration, about" : "Duration",
      value: formatSpan(overview.seconds),
      ...(overview.unknownLapSteps > 0
        ? { note: `plus ${lapStepsText(overview.unknownLapSteps)}` }
        : overview.lapSteps > 0
          ? { note: "lap-button steps at their expected length" }
          : {}),
    },
  ];
  if (overview.meters > 0)
    figures.push({ label: "Distance", value: formatMeters(overview.meters) });
  if (overview.load) {
    figures.push({ label: "Load", value: String(overview.load.score) });
    figures.push({ label: "Intensity", value: overview.load.intensityFactor.toFixed(2) });
  }
  if (overview.averagePower !== null) {
    figures.push({ label: "Avg power", value: String(overview.averagePower), unit: "W" });
  }
  return (
    <dl className="figures">
      {figures.map((figure) => (
        <div key={figure.label} className="figure">
          <dt>{figure.label}</dt>
          <dd>
            {figure.value}
            {figure.unit && <span className="unit">{figure.unit}</span>}
          </dd>
          {figure.note && <dd className="figure-note">{figure.note}</dd>}
        </div>
      ))}
      {!overview.load && overview.unknownLapSteps > 0 && (
        <div className="figure">
          <dt>Load</dt>
          <dd className="figure-note">Unknown until each lap-button step has an expected length</dd>
        </div>
      )}
      {!overview.load && overview.unknownLapSteps === 0 && reference.ftp === null && (
        <div className="figure">
          <dt>Load</dt>
          <dd className="figure-note">
            <Link to="/settings" className="text-link">
              Set your thresholds
            </Link>
          </dd>
        </div>
      )}
    </dl>
  );
}

export function ReferenceNote({
  overview,
  reference,
}: {
  overview: Overview;
  reference: Reference;
}) {
  const usesPower = overview.segments.some((segment) => segment.step.target?.type === "power");
  const usesPace = overview.segments.some((segment) => segment.step.target?.type === "pace");
  const usesHeartRate = overview.segments.some(
    (segment) => segment.step.target?.type === "heartRate",
  );
  const missing = [
    usesPower && reference.ftp === null ? "FTP" : null,
    usesPace && reference.thresholdSpeed === null ? "threshold pace" : null,
    usesHeartRate && reference.thresholdHeartRate === null ? "threshold heart rate" : null,
  ].filter(Boolean);
  const scaled = overview.segments.some((segment) => segment.scaled);
  if (missing.length === 0 && !scaled) {
    return (
      <p className="lede chart-note">
        Heights are a share of your threshold, coloured by your zones in Settings.
      </p>
    );
  }
  return (
    <p className="lede chart-note">
      Without your {missing.join(" and ")}, targets show as written and zones are estimated.{" "}
      <Link to="/settings" className="text-link">
        Set them in Settings
      </Link>
    </p>
  );
}

function download(file: ExportedWorkout) {
  const url = URL.createObjectURL(new Blob([exportedBytes(file)], { type: file.contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const exportFormats = workoutFileFormats.filter((format) => format !== "fit");

function ExportSection({
  source,
  name,
  ftp,
}: {
  source: WorkoutSource;
  name: string;
  ftp: number | null;
}) {
  const [result, setResult] = useState<{
    format: WorkoutFileFormat;
    exported: Exported;
    downloaded: boolean;
  } | null>(null);
  const run = useMutation({
    mutationFn: async (format: WorkoutFileFormat) => ({
      format,
      exported: await exportWorkout(api, source, format, ftp),
    }),
    onMutate: () => setResult(null),
    onSuccess: ({ format, exported }) => {
      const waits =
        exported.kind === "file" &&
        exported.file.warnings.some(
          (warning) => format === "fit" || warning.code === "approximated",
        );
      if (exported.kind === "file" && !waits) download(exported.file);
      setResult({ format, exported, downloaded: !waits });
    },
  });
  const button = (format: WorkoutFileFormat, label: string) => (
    <button
      key={format}
      type="button"
      className="secondary compact"
      disabled={run.isPending}
      onClick={() => run.mutate(format)}
    >
      {label}
    </button>
  );
  return (
    <section aria-labelledby="export-title">
      <h2 id="export-title" className="section-title">
        Export
      </h2>
      <p className="lede">Download {name} for Zwift, TrainerRoad, Wahoo SYSTM and other apps.</p>
      <div className="export-buttons">
        {exportFormats.map((format) => button(format, `.${format}`))}
      </div>
      <p className="lede">Or as a .fit file for a Garmin, Wahoo or COROS device.</p>
      <div className="export-buttons">{button("fit", ".fit")}</div>
      {run.isError && (
        <p role="alert" className="notice">
          The file was not made. Try again.
        </p>
      )}
      {result?.exported.kind === "file" && result.downloaded && (
        <div role="status" className="export-result">
          <p className="lede">Downloaded {result.exported.file.fileName}.</p>
          <FormatIssues
            issues={result.exported.file.warnings}
            title={`Left out of the .${result.format} file:`}
          />
        </div>
      )}
      {result?.exported.kind === "file" && !result.downloaded && (
        <div role="status" className="export-result">
          <p className="lede">
            A .{result.format} file cannot say everything in this workout. It will differ:
          </p>
          <FormatIssues issues={result.exported.file.warnings} title="Changed or left out:" />
          <div className="export-buttons">
            <button
              type="button"
              className="primary compact"
              onClick={() => {
                if (result.exported.kind !== "file") return;
                download(result.exported.file);
                setResult({ ...result, downloaded: true });
              }}
            >
              Download {result.exported.file.fileName}
            </button>
          </div>
        </div>
      )}
      {result?.exported.kind === "refused" && (
        <div role="alert" className="export-result">
          <p className="notice">This workout cannot be written as a .{result.format} file.</p>
          <FormatIssues issues={result.exported.issues} title="Why:" />
          {result.format === "fit" ? (
            <p className="lede">
              <Link to="/settings" className="text-link">
                Setting your thresholds
              </Link>{" "}
              lets Trainstack write heart rate and pace targets in bpm and speed.
            </p>
          ) : (
            ftp === null && (
              <p className="lede">
                <Link to="/settings" className="text-link">
                  Setting your FTP
                </Link>{" "}
                lets Trainstack write power in watts.
              </p>
            )
          )}
        </div>
      )}
    </section>
  );
}
