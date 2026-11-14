import {
  findExercise,
  type CustomExercise,
  type MassUnit,
  type SetKind,
} from "@trainstack/logbook";
import { useState } from "react";

import { api, queryClient } from "../api";
import { activityDate } from "../lib/dates";
import {
  blankSet,
  type ExerciseDraft,
  exerciseChoices,
  exerciseFromHistory,
  exerciseName,
  groupWithNext,
  type LoadKind,
  loadKindLabels,
  movedExercise,
  newKey,
  nextSet,
  repeatStrength,
  type SetDraft,
  setKindLabels,
  setKindMarks,
  type StrengthDraft,
  withWholeGroups,
} from "../lib/logbook";
import {
  exercisesKey,
  latestWith,
  useExercises,
  useLatest,
  usePreferredUnit,
} from "./logbook-data";

const kinds: SetKind[] = ["working", "warm_up", "drop", "failure"];

export function StrengthEditor({
  draft,
  onChange,
  updateDraft,
  onAdding,
  editing,
}: {
  draft: StrengthDraft;
  onChange: (draft: StrengthDraft) => void;
  onAdding: (adding: boolean) => void;
  updateDraft: (change: (draft: StrengthDraft) => StrengthDraft) => void;
  editing: boolean;
}) {
  const exercises = useExercises();
  const latest = useLatest("strength");
  const [, setPreferredUnit] = usePreferredUnit();
  const custom = exercises.data?.custom ?? [];
  const last = latest.data;

  const setExercises = (next: ExerciseDraft[]) => onChange({ ...draft, exercises: next });
  const update = (key: string, change: (entry: ExerciseDraft) => ExerciseDraft) =>
    setExercises(draft.exercises.map((entry) => (entry.key === key ? change(entry) : entry)));

  async function add(exerciseId: string) {
    onAdding(true);
    const previous = await latestWith(exerciseId).catch(() => null);
    updateDraft((current) => ({
      ...current,
      exercises: [
        ...current.exercises,
        exerciseFromHistory(exerciseId, previous, current.unit, custom),
      ],
    }));
    onAdding(false);
  }

  return (
    <>
      <div className="log-toolbar">
        {!editing && draft.exercises.length === 0 && last && (
          <button
            type="button"
            className="secondary"
            onClick={() => onChange(repeatStrength(draft, last))}
          >
            Repeat {activityDate(last.session.startedAt)}
            <span className="button-detail">
              {last.summary.sport === "strength" ? `${last.summary.exercises} exercises` : ""}
            </span>
          </button>
        )}
        <UnitSwitch
          unit={draft.unit}
          onChange={(unit) => {
            setPreferredUnit(unit);
            onChange({
              ...draft,
              unit,
              exercises: draft.exercises.map((entry) => ({
                ...entry,
                sets: entry.sets.map((set) => ({ ...set, unit })),
              })),
            });
          }}
        />
      </div>
      <ol className="log-exercises">
        {draft.exercises.map((entry, index) => (
          <li key={entry.key}>
            <ExerciseCard
              entry={entry}
              custom={custom}
              unit={draft.unit}
              groupedWithNext={
                entry.group !== null && draft.exercises[index + 1]?.group === entry.group
              }
              last={index === draft.exercises.length - 1}
              onChange={(change) => update(entry.key, change)}
              onRemove={() =>
                setExercises(
                  withWholeGroups(draft.exercises.filter(({ key }) => key !== entry.key)),
                )
              }
              onGroupWithNext={(together) =>
                setExercises(groupWithNext(draft.exercises, index, together))
              }
              onMove={(by) => setExercises(movedExercise(draft.exercises, index, by))}
            />
          </li>
        ))}
      </ol>
      <ExercisePicker
        custom={custom}
        used={exercises.data?.used ?? []}
        onPick={add}
        first={draft.exercises.length === 0}
      />
    </>
  );
}

function UnitSwitch({ unit, onChange }: { unit: MassUnit; onChange: (unit: MassUnit) => void }) {
  return (
    <div className="segmented unit-switch" role="group" aria-label="Weight unit">
      {(["kg", "lb"] as const).map((option) => (
        <button
          key={option}
          type="button"
          className="segment"
          aria-pressed={unit === option}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function ExerciseCard({
  entry,
  custom,
  unit,
  groupedWithNext,
  last,
  onChange,
  onRemove,
  onGroupWithNext,
  onMove,
}: {
  entry: ExerciseDraft;
  custom: CustomExercise[];
  unit: MassUnit;
  groupedWithNext: boolean;
  last: boolean;
  onChange: (change: (entry: ExerciseDraft) => ExerciseDraft) => void;
  onRemove: () => void;
  onGroupWithNext: (together: boolean) => void;
  onMove: (by: number) => void;
}) {
  const [more, setMore] = useState(false);
  const exercise = findExercise(entry.exerciseId, custom);
  const timed = exercise?.measure === "time";
  const bodyweight = exercise?.bodyweight ?? false;
  const setSets = (sets: SetDraft[]) => onChange((current) => ({ ...current, sets }));
  const updateSet = (key: string, change: Partial<SetDraft>) =>
    setSets(entry.sets.map((set) => (set.key === key ? { ...set, ...change } : set)));
  let working = 0;
  return (
    <article className={`log-exercise${entry.group !== null ? " grouped" : ""}`}>
      <header className="log-exercise-head">
        <h3>{exerciseName(entry.exerciseId, custom)}</h3>
        <div className="log-exercise-actions">
          <button
            type="button"
            className="quiet"
            onClick={() => setMore(!more)}
            aria-expanded={more}
          >
            {more ? "Less" : "More"}
          </button>
          <button type="button" className="quiet" onClick={() => onMove(-1)} aria-label="Move up">
            ↑
          </button>
          <button
            type="button"
            className="quiet danger"
            onClick={onRemove}
            aria-label="Remove exercise"
          >
            ✕
          </button>
        </div>
      </header>
      <div className={`set-grid${more ? " more" : ""}`} role="table" aria-label="Sets">
        <div className="set-row set-labels" role="row">
          <span role="columnheader">Set</span>
          <span role="columnheader">{bodyweight ? "Load" : unit}</span>
          <span role="columnheader">{timed ? "Seconds" : "Reps"}</span>
          <span role="columnheader">RPE</span>
          {more && (
            <>
              <span role="columnheader">RIR</span>
              <span role="columnheader">Tempo</span>
              <span role="columnheader">Rest s</span>
            </>
          )}
          <span role="columnheader">
            <span className="visually-hidden">Remove</span>
          </span>
        </div>
        {entry.sets.map((set) => {
          if (set.kind !== "warm_up") working++;
          return (
            <SetRow
              key={set.key}
              set={set}
              number={working}
              timed={timed}
              bodyweight={bodyweight}
              more={more}
              onChange={(change) => updateSet(set.key, change)}
              onRemove={() => setSets(entry.sets.filter(({ key }) => key !== set.key))}
            />
          );
        })}
      </div>
      <div className="log-exercise-foot">
        <button
          type="button"
          className="secondary add-set"
          onClick={() => setSets([...entry.sets, nextSet(entry.sets, blankSet(exercise, unit))])}
        >
          + Add set
        </button>
        {!last && (
          <label className="superset">
            <input
              type="checkbox"
              checked={groupedWithNext}
              onChange={(event) => onGroupWithNext(event.target.checked)}
            />
            Superset with next
          </label>
        )}
      </div>
      {more && (
        <label className="field">
          Notes
          <input
            value={entry.notes}
            maxLength={1000}
            onChange={(event) => onChange((current) => ({ ...current, notes: event.target.value }))}
          />
        </label>
      )}
    </article>
  );
}

const decimal = (value: string) => value.replace(",", ".").replace(/[^0-9.]/g, "");
const whole = (value: string) => value.replace(/[^0-9]/g, "");

function SetRow({
  set,
  number,
  timed,
  bodyweight,
  more,
  onChange,
  onRemove,
}: {
  set: SetDraft;
  number: number;
  timed: boolean;
  bodyweight: boolean;
  more: boolean;
  onChange: (change: Partial<SetDraft>) => void;
  onRemove: () => void;
}) {
  const nextKind = kinds[(kinds.indexOf(set.kind) + 1) % kinds.length]!;
  const showsMass = set.loadKind !== "bodyweight";
  return (
    <div className={`set-row kind-${set.kind}`} role="row">
      <button
        type="button"
        className="set-kind"
        title={`${setKindLabels[set.kind]}. Tap for ${setKindLabels[nextKind].toLowerCase()}`}
        aria-label={`${setKindLabels[set.kind]} set. Change to ${setKindLabels[nextKind].toLowerCase()}`}
        onClick={() => onChange({ kind: nextKind })}
      >
        {setKindMarks[set.kind] || number}
      </button>
      <span className="set-load" role="cell">
        {(bodyweight || more || set.loadKind !== "weight") && (
          <select
            aria-label="Load"
            value={set.loadKind}
            onChange={(event) => onChange({ loadKind: event.target.value as LoadKind })}
          >
            {(Object.keys(loadKindLabels) as LoadKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {loadKindLabels[kind]}
              </option>
            ))}
          </select>
        )}
        {showsMass && (
          <input
            aria-label={`Weight in ${set.unit}`}
            inputMode="decimal"
            value={set.mass}
            placeholder={set.unit}
            onChange={(event) => onChange({ mass: decimal(event.target.value) })}
          />
        )}
      </span>
      <input
        role="cell"
        aria-label={timed ? "Seconds" : "Reps"}
        inputMode="numeric"
        value={timed ? set.seconds : set.reps}
        onChange={(event) =>
          onChange(
            timed ? { seconds: whole(event.target.value) } : { reps: whole(event.target.value) },
          )
        }
      />
      <input
        role="cell"
        aria-label="RPE"
        inputMode="decimal"
        value={set.rpe}
        placeholder="–"
        onChange={(event) => onChange({ rpe: decimal(event.target.value) })}
      />
      {more && (
        <>
          <input
            role="cell"
            aria-label="Reps in reserve"
            inputMode="numeric"
            value={set.repsInReserve}
            placeholder="–"
            onChange={(event) => onChange({ repsInReserve: whole(event.target.value) })}
          />
          <input
            role="cell"
            aria-label="Tempo"
            value={set.tempo}
            placeholder="–"
            maxLength={7}
            onChange={(event) => onChange({ tempo: event.target.value })}
          />
          <input
            role="cell"
            aria-label="Rest in seconds"
            inputMode="numeric"
            value={set.rest}
            placeholder="–"
            onChange={(event) => onChange({ rest: whole(event.target.value) })}
          />
        </>
      )}
      <button type="button" className="quiet set-remove" aria-label="Remove set" onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}

function ExercisePicker({
  custom,
  used,
  onPick,
  first,
}: {
  custom: CustomExercise[];
  used: { exerciseId: string }[];
  onPick: (exerciseId: string) => Promise<void>;
  first: boolean;
}) {
  const [query, setQuery] = useState("");
  const [chosenOpen, setOpen] = useState(false);
  const open = first || chosenOpen;
  const [busy, setBusy] = useState(false);
  const choices = exerciseChoices(query, custom, used).slice(0, query ? 12 : 8);
  const exact = choices.some(({ name }) => name.toLowerCase() === query.trim().toLowerCase());

  const [failed, setFailed] = useState(false);

  async function pick(exerciseId: string) {
    setBusy(true);
    await onPick(exerciseId);
    setBusy(false);
    setQuery("");
    setOpen(false);
  }

  async function createOwn() {
    const name = query.trim();
    const id = newKey();
    setBusy(true);
    setFailed(false);
    try {
      await api.logbook.putExercise({
        id,
        exercise: {
          name,
          equipment: "other",
          primaryMuscles: [],
          secondaryMuscles: [],
          measure: "reps",
          bodyweight: false,
        },
        editedAt: new Date(),
      });
    } catch {
      setFailed(true);
      setBusy(false);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: exercisesKey });
    await pick(id);
  }

  if (!open) {
    return (
      <button type="button" className="secondary add-exercise" onClick={() => setOpen(true)}>
        + Add exercise
      </button>
    );
  }
  return (
    <section className="exercise-picker" aria-label="Add an exercise">
      <input
        type="search"
        autoFocus={!first}
        placeholder="Search exercises"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {failed && (
        <p role="alert" className="notice">
          Your exercise was not added. Check your connection and try again.
        </p>
      )}
      <ul className="exercise-choices">
        {choices.map((exercise) => (
          <li key={exercise.id}>
            <button
              type="button"
              className="exercise-choice"
              disabled={busy}
              onClick={() => pick(exercise.id)}
            >
              <span>{exercise.name}</span>
              <span className="muted">
                {exercise.primaryMuscles.join(", ").replaceAll("_", " ")}
              </span>
            </button>
          </li>
        ))}
        {query.trim() !== "" && !exact && (
          <li>
            <button
              type="button"
              className="exercise-choice own"
              disabled={busy}
              onClick={createOwn}
            >
              <span>Add “{query.trim()}”</span>
              <span className="muted">as your own exercise</span>
            </button>
          </li>
        )}
      </ul>
      {!first && (
        <button type="button" className="quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      )}
    </section>
  );
}
