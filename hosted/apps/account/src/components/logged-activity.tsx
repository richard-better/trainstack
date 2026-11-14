import type { ActivityDetail, StoredSession } from "@trainstack/contract";
import {
  type BoulderingDetail,
  type CustomExercise,
  type ExerciseNumbers,
  findExercise,
  gradePyramid,
  type MassUnit,
  type PyramidScale,
  type StrengthDetail,
} from "@trainstack/logbook";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { activityKey, api } from "../api";
import { activityDateInFull } from "../lib/dates";
import {
  exerciseName,
  formatMass,
  formatVolume,
  gradeText,
  gradeValueText,
  outcomeLabels,
  recordLabels,
  setKindLabels,
  setSummary,
} from "../lib/logbook";
import { activityTitle, sportName } from "../lib/sports";
import { type Figure, formatDuration, formatLoad } from "../lib/statistics";
import { sourceLabel } from "../lib/workouts";
import { Figures, Shell } from "./activity-detail";
import { deleteSession, useExercises, useStoredSession } from "./logbook-data";
import { SportIcon } from "./sport-icon";
import { Sources } from "./workout-sources";

export function LoggedActivity({
  activity,
  sessionId,
}: {
  activity: ActivityDetail;
  sessionId: string;
}) {
  const stored = useStoredSession(sessionId);
  const title = activityTitle(activity);
  const { label, family } = sportName(activity.sport, activity.indoor);

  useEffect(() => {
    document.title = `${title} - Trainstack`;
    return () => {
      document.title = "Trainstack";
    };
  }, [title]);

  const startedAt = activity.startedAt ?? activity.createdAt;
  return (
    <Shell>
      <header className="detail-head">
        <p className="detail-meta">
          <span className="detail-sport">
            <SportIcon family={family} />
            {label}
          </span>
          <time dateTime={startedAt.toISOString()}>{activityDateInFull(startedAt)}</time>
          {activity.duplicates.length > 0 && (
            <a href="#sources" className="text-link">
              {activity.duplicates.length + 1} sources
            </a>
          )}
        </p>
        <h1 className="detail-title">{title}</h1>
        {stored.data && <LoggedActions activity={activity} stored={stored.data} />}
      </header>
      {stored.isPending ? (
        <div className="figures skeleton" aria-busy="true" aria-label="Loading session" />
      ) : stored.data ? (
        <Session stored={stored.data} activity={activity} />
      ) : (
        <div className="state" role="alert">
          <p className="state-title">This session did not load.</p>
          <button type="button" className="secondary" onClick={() => stored.refetch()}>
            Try again
          </button>
        </div>
      )}
      <Sources activity={activity} title={title} />
    </Shell>
  );
}

function sessionFigures(stored: StoredSession, unit: MassUnit): Figure[] {
  const figures: Figure[] = [
    {
      name: "duration",
      label: "Duration",
      value: formatDuration(stored.session.durationSeconds),
      unit: "",
    },
  ];
  if (stored.load) {
    figures.push({
      name: "load",
      label: "Load",
      value: formatLoad(stored.load.stressScore),
      unit: "",
    });
  }
  const { summary } = stored;
  if (summary.sport === "strength") {
    figures.push({ name: "sets", label: "Sets", value: String(summary.sets), unit: "" });
    figures.push({ name: "reps", label: "Reps", value: String(summary.reps), unit: "" });
    if (summary.volumeKg !== null) {
      const [value, volumeUnit] = formatVolume(summary.volumeKg, unit).split(" ");
      figures.push({ name: "volume", label: "Volume", value: value!, unit: volumeUnit! });
    }
  } else {
    figures.push({
      name: "problems",
      label: "Problems",
      value: String(summary.problems),
      unit: "",
    });
    figures.push({ name: "tops", label: "Tops", value: String(summary.tops), unit: "" });
    figures.push({ name: "flashes", label: "Flashes", value: String(summary.flashes), unit: "" });
    figures.push({
      name: "attempts",
      label: "Attempts",
      value: String(summary.attempts),
      unit: "",
    });
    const hardest = gradeValueText(summary.hardestTop);
    if (hardest) figures.push({ name: "hardest", label: "Hardest top", value: hardest, unit: "" });
  }
  return figures;
}

function Session({ stored, activity }: { stored: StoredSession; activity: ActivityDetail }) {
  const exercises = useExercises();
  const unit = stored.summary.sport === "strength" ? stored.summary.unit : "kg";
  const custom = exercises.data?.custom ?? [];
  const { session } = stored;
  return (
    <>
      <Figures
        figures={sessionFigures(stored, unit)}
        details={
          stored.load && session.rpe !== null
            ? { load: `session RPE ${session.rpe}, estimated` }
            : {}
        }
      />
      {session.rpe === null && (
        <p className="lede logged-note">
          This session counts no load toward your fitness, because it has no rating of how hard it
          was. Edit it to add one.
        </p>
      )}
      <WatchData activity={activity} />
      {stored.numbers.sport === "strength" && stored.numbers.records.length > 0 && (
        <section aria-labelledby="records" className="records">
          <h2 id="records" className="section-title">
            Personal records
          </h2>
          <ul>
            {stored.numbers.records.map((record) => (
              <li key={`${record.exerciseId} ${record.kind}`}>
                <span className="record-mark" aria-hidden="true">
                  PR
                </span>
                <span>
                  {exerciseName(record.exerciseId, custom)}: {recordLabels[record.kind]}{" "}
                  <strong>{recordValue(record.kind, record.value, unit)}</strong>{" "}
                  <span className="muted">
                    was {recordValue(record.kind, record.previous, unit)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {session.detail.sport === "strength" && stored.numbers.sport === "strength" ? (
        <StrengthSets
          detail={session.detail}
          numbers={stored.numbers.exercises}
          custom={custom}
          unit={unit}
          bodyMassKg={stored.bodyMassKg}
        />
      ) : session.detail.sport === "bouldering" ? (
        <Problems detail={session.detail} />
      ) : null}
      {session.notes && (
        <section aria-labelledby="notes">
          <h2 id="notes" className="section-title">
            Notes
          </h2>
          <p className="lede logged-notes">{session.notes}</p>
        </section>
      )}
    </>
  );
}

function recordValue(kind: keyof typeof recordLabels, value: number, unit: MassUnit) {
  if (kind === "most_reps") return `${value} reps`;
  if (kind === "longest") return `${Math.round(value)} s`;
  if (kind === "volume") return formatVolume(value, unit);
  return formatMass(value, unit);
}

function WatchData({ activity }: { activity: ActivityDetail }) {
  const recorded = activity.duplicates.find((duplicate) => duplicate.file !== null);
  const detail = useQuery({
    queryKey: activityKey(recorded?.id ?? ""),
    queryFn: () => api.activities.get({ id: recorded!.id }),
    enabled: recorded !== undefined,
  });
  if (!recorded || !detail.data) return null;
  const { statistics } = detail.data;
  const average = statistics.average_heart_rate_bpm;
  const max = statistics.max_heart_rate_bpm;
  if (average === undefined && max === undefined) return null;
  return (
    <section aria-labelledby="heart-rate" className="watch-data">
      <h2 id="heart-rate" className="section-title">
        Heart rate
      </h2>
      <p className="lede">
        From the{" "}
        <Link to="/activities/$id" params={{ id: recorded.id }} className="text-link">
          {sourceLabel(recorded)} recording
        </Link>{" "}
        of this session.
      </p>
      <Figures
        figures={[
          ...(average !== undefined
            ? [
                {
                  name: "average",
                  label: "Avg heart rate",
                  value: String(Math.round(average)),
                  unit: "bpm",
                },
              ]
            : []),
          ...(max !== undefined
            ? [
                {
                  name: "max",
                  label: "Max heart rate",
                  value: String(Math.round(max)),
                  unit: "bpm",
                },
              ]
            : []),
        ]}
      />
    </section>
  );
}

function StrengthSets({
  detail,
  numbers,
  custom,
  unit,
  bodyMassKg,
}: {
  detail: StrengthDetail;
  numbers: ExerciseNumbers[];
  custom: CustomExercise[];
  unit: MassUnit;
  bodyMassKg: number | null;
}) {
  const byExercise = new Map(numbers.map((entry) => [entry.exerciseId, entry]));
  const usesBodyweight = detail.exercises.some(({ sets }) =>
    sets.some(({ load }) => load.kind !== "weight"),
  );
  return (
    <section aria-labelledby="exercises" className="logged-exercises">
      <h2 id="exercises" className="section-title">
        Exercises
      </h2>
      {usesBodyweight && bodyMassKg === null && (
        <p className="lede logged-note">
          Bodyweight sets count reps but no weight, because your weight is not set in Settings.
        </p>
      )}
      <ol>
        {detail.exercises.map((entry, index) => {
          const exercise = findExercise(entry.exerciseId, custom);
          const summary = byExercise.get(entry.exerciseId);
          const together =
            entry.group !== null &&
            (detail.exercises[index - 1]?.group === entry.group ||
              detail.exercises[index + 1]?.group === entry.group);
          let working = 0;
          return (
            <li key={index} className={together ? "grouped" : undefined}>
              <header className="logged-exercise-head">
                <h3>
                  {exercise?.name ?? "Exercise"}
                  {together && <span className="superset-mark">Superset</span>}
                </h3>
                {summary && (
                  <p className="muted">
                    {summary.volumeKg !== null && `${formatVolume(summary.volumeKg, unit)} volume`}
                    {summary.estimatedOneRepMaxKg !== null &&
                      ` · est. 1RM ${formatMass(summary.estimatedOneRepMaxKg, unit)}`}
                  </p>
                )}
              </header>
              <table className="logged-sets">
                <thead>
                  <tr>
                    <th scope="col">Set</th>
                    <th scope="col">Load</th>
                    <th scope="col">{exercise?.measure === "time" ? "Time" : "Reps"}</th>
                    <th scope="col">RPE</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.sets.map((set, setIndex) => {
                    if (set.kind !== "warm_up") working++;
                    const { weight, amount } = setSummary(set);
                    return (
                      <tr key={setIndex} className={`kind-${set.kind}`}>
                        <td title={setKindLabels[set.kind]}>
                          {set.kind === "warm_up"
                            ? "W"
                            : set.kind === "drop"
                              ? `${working}D`
                              : set.kind === "failure"
                                ? `${working}F`
                                : working}
                        </td>
                        <td>{weight}</td>
                        <td>{amount}</td>
                        <td>
                          {set.rpe ??
                            (set.repsInReserve !== null ? `${set.repsInReserve} RIR` : "")}
                          {set.tempo && <span className="muted"> {set.tempo}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {entry.notes && <p className="lede">{entry.notes}</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function sessionScale(detail: BoulderingDetail): PyramidScale {
  const counts = { font: 0, v: 0, circuit: 0 };
  for (const { grade } of detail.problems) counts[grade.scale]++;
  if (detail.circuit && counts.circuit >= counts.font && counts.circuit >= counts.v) {
    return { circuit: detail.circuit.name };
  }
  return counts.v > counts.font ? "v" : "font";
}

function Problems({ detail }: { detail: BoulderingDetail }) {
  const scale = sessionScale(detail);
  const pyramid = gradePyramid([detail], scale);
  const widest = Math.max(
    1,
    ...pyramid.steps.map((step) => step.flashes + step.sends + step.projects),
  );
  return (
    <section aria-labelledby="problems" className="logged-problems">
      <h2 id="problems" className="section-title">
        Problems
      </h2>
      {detail.venue.name && (
        <p className="lede">
          {detail.venue.kind === "gym" ? "At" : "At the crag"} {detail.venue.name}
        </p>
      )}
      {pyramid.steps.length > 0 && <Pyramid steps={pyramid.steps} widest={widest} />}
      <ol className="problem-list">
        {detail.problems.map((problem, index) => (
          <li key={index} className={`outcome-${problem.outcome}`}>
            <span className="problem-grade">{gradeText(problem.grade)}</span>
            <span>
              {outcomeLabels[problem.outcome]}
              {problem.outcome !== "flash" && (
                <span className="muted">
                  {" "}
                  · {problem.attempts} {problem.attempts === 1 ? "attempt" : "attempts"}
                </span>
              )}
            </span>
            <span className="muted">
              {[problem.name, problem.angle, ...problem.styles].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Pyramid({
  steps,
  widest,
}: {
  steps: { grade: string; flashes: number; sends: number; projects: number }[];
  widest: number;
}) {
  return (
    <ol className="pyramid" aria-label="Grade pyramid">
      {steps.map((step) => (
        <li key={step.grade}>
          <span className="pyramid-grade">{step.grade}</span>
          <span className="pyramid-bar" aria-hidden="true">
            <span className="flashes" style={{ width: `${(step.flashes / widest) * 100}%` }} />
            <span className="sends" style={{ width: `${(step.sends / widest) * 100}%` }} />
            <span className="projects" style={{ width: `${(step.projects / widest) * 100}%` }} />
          </span>
          <span className="pyramid-count">
            {step.flashes + step.sends > 0 && `${step.flashes + step.sends} sent`}
            {step.flashes > 0 && <span className="muted"> ({step.flashes} flashed)</span>}
            {step.projects > 0 && (
              <span className="muted">
                {step.flashes + step.sends > 0 ? " · " : ""}
                {step.projects} {step.projects === 1 ? "project" : "projects"}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function LoggedActions({ activity, stored }: { activity: ActivityDetail; stored: StoredSession }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => deleteSession(stored),
    onSuccess: async () => {
      dialog.current?.close();
      const remaining = activity.duplicates[0];
      await (remaining
        ? navigate({ to: "/activities/$id", params: { id: remaining.id } })
        : navigate({ to: "/activities" }));
    },
  });
  const sport = stored.session.detail.sport;
  return (
    <div className="actions">
      <Link
        to={sport === "strength" ? "/log/strength" : "/log/bouldering"}
        search={{ id: stored.id }}
        className="secondary link-button"
      >
        Edit
      </Link>
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
        aria-labelledby="confirm-title"
        onClose={() => remove.reset()}
      >
        <h2 id="confirm-title">Delete this session?</h2>
        <p className="lede">
          What you logged is removed from your account and will not come back from another device.
          {activity.duplicates.length > 0 && " The recording from your watch stays."}
        </p>
        {remove.isError && (
          <p role="alert" className="notice">
            The session was not deleted. Try again.
          </p>
        )}
        <div className="confirm-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => dialog.current?.close()}
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            className="destructive"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            {remove.isPending ? "Deleting…" : "Delete session"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
