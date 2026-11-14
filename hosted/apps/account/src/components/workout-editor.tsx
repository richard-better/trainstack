import type { StoredWorkout } from "@trainstack/contract";
import {
  type Block,
  focusSchema,
  type Sport,
  sportSchema,
  type Workout,
} from "@trainstack/workout";
import { useMutation } from "@tanstack/react-query";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, queryClient } from "../api";
import {
  blankWorkout,
  blockAt,
  duplicateBlock,
  edit,
  groupable,
  groupIntoRepeat,
  type History,
  insertAt,
  moveBlock,
  newStep,
  parsePath,
  type Path,
  pathAfterMove,
  pathKey,
  problemsByPath,
  problemsOf,
  redo,
  removeBlocks,
  startHistory,
  undo,
  ungroup,
  updateBlock,
} from "../lib/workout-editor";
import { focusNames, overviewOf, sportNames } from "../lib/workout-profile";
import { type SaveOutcome, sameWorkout, saveWorkout } from "../lib/workout-save";
import { FieldErrorsProvider, Select, TextField, useFieldErrors } from "./editor-fields";
import { type StepActions, StepTree } from "./editor-steps";
import { useWidth, WorkoutChart } from "./workout-chart";
import { forgetWorkout, rememberWorkout, useReference } from "./workout-data";
import { Shell, useStoredWorkout, workoutKey } from "./workout-page";

export function EditWorkoutPage({ id }: { id: string }) {
  const { valid, workout, query } = useStoredWorkout(id);
  const [opened, setOpened] = useState<StoredWorkout | null>(null);
  if (workout?.id === id && opened?.id !== id) setOpened(workout);
  if (opened?.id === id) {
    return <WorkoutEditor key={opened.id} id={opened.id} initial={opened.workout} base={opened} />;
  }
  if (!valid || query.isError) {
    return (
      <Shell>
        <div className="state" role="alert">
          <p className="state-title">This workout cannot be edited.</p>
          <p className="lede">It may have been deleted on another device, or it did not load.</p>
          <Link to="/workouts" search={{}} className="secondary link-button">
            See your workouts
          </Link>
        </div>
      </Shell>
    );
  }
  return (
    <Shell>
      <div className="traces-loading" aria-busy="true" aria-label="Loading workout" />
    </Shell>
  );
}

export function NewWorkoutPage({ sport }: { sport: Sport }) {
  const [id] = useState(() => crypto.randomUUID());
  const [initial] = useState(() => blankWorkout(sport));
  return <WorkoutEditor id={id} initial={initial} base={null} />;
}

type Conflict = Extract<SaveOutcome, { kind: "changed" | "overruled" | "deleted" }>;

function useEditorShortcuts(handlers: { undo: () => void; redo: () => void; save: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        handlers.undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        handlers.redo();
      } else if (key === "s") {
        event.preventDefault();
        handlers.save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
}

function WorkoutEditor({
  id: initialId,
  initial,
  base: initialBase,
}: {
  id: string;
  initial: Workout;
  base: StoredWorkout | null;
}) {
  const navigate = useNavigate();
  const [id, setId] = useState(initialId);
  const [history, setHistory] = useState<History>(() => startHistory(initial));
  const [saved, setSaved] = useState<{ workout: Workout; base: StoredWorkout | null }>({
    workout: initial,
    base: initialBase,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const reveal = (path: Path) => {
    setSelected(pathKey(path));
    setRevealed(pathKey(path));
  };
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const fieldErrors = useFieldErrors();
  const leaving = useRef(false);
  const draft = history.draft;
  const { reference } = useReference(draft.sport);
  const overview = useMemo(() => overviewOf(draft, reference), [draft, reference]);
  const problems = useMemo(() => problemsOf(draft), [draft]);
  const byPath = useMemo(() => problemsByPath(problems), [problems]);
  const dirty = !sameWorkout(draft, saved.workout) || saved.base === null;
  const invalid = problems.length > 0 || fieldErrors.invalid.size > 0;
  const [plotRef, plotWidth] = useWidth<HTMLDivElement>();

  const apply = useCallback((change: (draft: Workout) => Workout, key: string | null = null) => {
    setHistory((current) => edit(current, change(current.draft), key));
  }, []);

  const save = useMutation({
    mutationFn: (overwrite: boolean) =>
      saveWorkout(api, {
        id,
        workout: history.draft,
        base: saved.base?.updatedAt ?? null,
        overwrite,
      }),
    onMutate: () => {
      setRefusal(null);
      setConflict(null);
    },
    onSuccess: async (outcome) => {
      switch (outcome.kind) {
        case "saved":
          await rememberWorkout(outcome.stored);
          queryClient.setQueryData(workoutKey(outcome.stored.id), outcome.stored);
          setSaved({ workout: outcome.stored.workout, base: outcome.stored });
          if (!saved.base) {
            leaving.current = true;
            void navigate({
              to: "/workouts/$id/edit",
              params: { id: outcome.stored.id },
              replace: true,
            });
          }
          return;
        case "refused":
          setRefusal(outcome.reason);
          return;
        case "deleted":
          await forgetWorkout(id);
          setConflict(outcome);
          return;
        default:
          setConflict(outcome);
      }
    },
  });

  const canSave = !invalid && !save.isPending && dirty;
  const firstSave = save.isPending && saved.base === null;
  const travel = useCallback((step: (history: History) => History) => {
    setChecked(new Set());
    setHistory(step);
  }, []);
  const trySave = useCallback(() => {
    if (canSave) save.mutate(false);
  }, [canSave, save]);

  useEditorShortcuts(
    useMemo(
      () =>
        firstSave
          ? { undo: () => {}, redo: () => {}, save: () => {} }
          : { undo: () => travel(undo), redo: () => travel(redo), save: trySave },
      [firstSave, travel, trySave],
    ),
  );

  useBlocker({
    shouldBlockFn: () =>
      !leaving.current && dirty && !window.confirm("Leave without saving your changes?"),
    enableBeforeUnload: () => dirty,
  });

  const actions: StepActions = useMemo(
    () => ({
      change: (path, block, key) =>
        apply(
          (current) => ({ ...current, steps: updateBlock(current.steps, path, () => block) }),
          key,
        ),
      select: (path) => setSelected(path ? pathKey(path) : null),
      revealed,
      toggleChecked: (path) =>
        setChecked((current) => {
          const next = new Set(current);
          const key = pathKey(path);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        }),
      move: (path, offset) => {
        const moved = moveBlock(history.draft.steps, path, offset);
        if (!moved) return;
        apply((current) => ({ ...current, steps: moved.blocks }));
        const follow = (current: string | null) =>
          current === null ? null : pathKey(pathAfterMove(parsePath(current), path, moved.path));
        setSelected(follow);
        setRevealed(follow);
        setChecked(new Set());
        const control = focusedControl();
        requestAnimationFrame(() => focusBlock(moved.path, control));
      },
      duplicate: (path) => {
        const copied = duplicateBlock(history.draft.steps, path);
        apply((current) => ({ ...current, steps: copied.blocks }));
        reveal(copied.path);
        setChecked(new Set());
      },
      remove: (path) => {
        if (history.draft.steps.length === 1 && path.length === 1) return;
        apply((current) => ({ ...current, steps: removeBlocks(current.steps, [path]) }));
        setSelected(null);
        setChecked(new Set());
      },
      ungroup: (path) => {
        apply((current) => ({ ...current, steps: ungroup(current.steps, path) }));
        setSelected(null);
        setChecked(new Set());
      },
      addStep: (parent) => {
        const container =
          parent.length === 0
            ? history.draft.steps
            : (blockAt(history.draft.steps, parent) as Extract<Block, { type: "repeat" }>).steps;
        const last = [...container].reverse().find((block) => block.type === "step");
        const at = [...parent, container.length];
        apply((current) => ({
          ...current,
          steps: insertAt(current.steps, at, [
            newStep(current.sport, last?.type === "step" ? last : undefined),
          ]),
        }));
        reveal(at);
      },
    }),
    [apply, history.draft, revealed],
  );

  const checkedPaths = [...checked].map(parsePath);
  const canGroup = groupable(checkedPaths) !== null;

  function groupChecked() {
    const grouped = groupIntoRepeat(history.draft.steps, checkedPaths);
    if (!grouped) return;
    apply((current) => ({ ...current, steps: grouped.blocks }));
    setChecked(new Set());
    setSelected(null);
  }

  function deleteChecked() {
    const remaining = removeBlocks(history.draft.steps, checkedPaths);
    if (remaining.length === 0) return;
    apply((current) => ({ ...current, steps: remaining }));
    setChecked(new Set());
    setSelected(null);
  }

  function keepTheirs(stored: StoredWorkout) {
    setChecked(new Set());
    void rememberWorkout(stored);
    queryClient.setQueryData(workoutKey(stored.id), stored);
    setHistory((current) => edit(current, stored.workout));
    setSaved({ workout: stored.workout, base: stored });
    setConflict(null);
  }

  function saveAsNew() {
    setId(crypto.randomUUID());
    setSaved((current) => ({ ...current, base: null }));
    setConflict(null);
  }

  const title = draft.name.trim() || "Untitled workout";
  const narrow = plotWidth > 0 && plotWidth < 560;

  return (
    <FieldErrorsProvider errors={fieldErrors.errors}>
      <main className="content detail editor" inert={firstSave}>
        <Link
          to={saved.base ? "/workouts/$id" : "/workouts"}
          params={{ id }}
          search={{}}
          className="back"
        >
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
          {saved.base ? "Back to workout" : "Workouts"}
        </Link>

        <div className="editor-bar">
          <div className="editor-history">
            <button
              type="button"
              className="secondary compact"
              onClick={() => travel(undo)}
              disabled={history.past.length === 0}
              title="Undo (⌘Z)"
            >
              Undo
            </button>
            <button
              type="button"
              className="secondary compact"
              onClick={() => travel(redo)}
              disabled={history.future.length === 0}
              title="Redo (⇧⌘Z)"
            >
              Redo
            </button>
          </div>
          <p className="editor-status" role="status">
            {save.isPending
              ? "Saving…"
              : invalid
                ? `Fix ${problems.length + fieldErrors.invalid.size === 1 ? "1 problem" : `${problems.length + fieldErrors.invalid.size} problems`} to save`
                : dirty
                  ? "Unsaved changes"
                  : "Saved"}
          </p>
          <button
            type="button"
            className="primary"
            onClick={trySave}
            disabled={!canSave}
            title="Save (⌘S)"
          >
            {saved.base ? "Save" : "Save workout"}
          </button>
        </div>

        {save.isError && (
          <p role="alert" className="notice editor-alert">
            The workout was not saved. Check your connection and try again.
          </p>
        )}
        {refusal && (
          <p role="alert" className="notice editor-alert">
            {refusal}
          </p>
        )}
        {conflict && (
          <ConflictPanel
            conflict={conflict}
            onKeepMine={() => {
              if (!invalid && !save.isPending) save.mutate(true);
            }}
            canKeepMine={!invalid && !save.isPending}
            onKeepTheirs={keepTheirs}
            onSaveAsNew={saveAsNew}
            onDiscard={() => {
              leaving.current = true;
              void navigate({ to: "/workouts", search: {} });
            }}
          />
        )}

        <header className="editor-head">
          <TextField
            label="Name"
            hideLabel
            value={draft.name}
            format={(value) => value}
            parse={(text) => text}
            problem={
              byPath.get("")?.find((problem) => problem.field === "name")
                ? "Give the workout a name"
                : undefined
            }
            onCommit={(name) => apply((current) => ({ ...current, name }), "name")}
          />
          <div className="form-row">
            <Select<Sport>
              label="Sport"
              value={draft.sport}
              options={sportSchema.options.map((sport) => [sport, sportNames[sport]] as const)}
              onChange={(sport) => apply((current) => ({ ...current, sport }))}
            />
            <Select
              label="Focus"
              value={draft.focus ?? "none"}
              options={[
                ["none", "Not set"],
                ...focusSchema.options.map((focus) => [focus, focusNames[focus]] as const),
              ]}
              onChange={(focus) =>
                apply((current) => ({ ...current, focus: focus === "none" ? undefined : focus }))
              }
            />
            <TextField
              label="Author"
              value={draft.author ?? ""}
              format={(value) => value}
              parse={(text) => text}
              width={160}
              onCommit={(author) =>
                apply(
                  (current) => ({ ...current, author: author.trim() ? author : undefined }),
                  "author",
                )
              }
            />
            <TextField
              label="Tags"
              value={(draft.tags ?? []).join(", ")}
              format={(value) => value}
              parse={(text) => text}
              width={200}
              hint="Words separated by commas"
              onCommit={(text) => {
                const tags = text
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean);
                apply(
                  (current) => ({ ...current, tags: tags.length > 0 ? tags : undefined }),
                  "tags",
                );
              }}
            />
          </div>
          <label className="field editor-field wide">
            <span>Description</span>
            <textarea
              rows={2}
              value={draft.description ?? ""}
              onChange={(event) => {
                const description = event.currentTarget.value;
                apply(
                  (current) => ({
                    ...current,
                    description: description.trim() ? description : undefined,
                  }),
                  "description",
                );
              }}
            />
          </label>
        </header>

        <section aria-labelledby="editor-profile" className="workout-section">
          <h2 id="editor-profile" className="section-title">
            Profile
          </h2>
          <div ref={plotRef}>
            <WorkoutChart
              overview={overview}
              reference={reference}
              highlight={selected}
              onHighlight={() => {}}
              title={title}
              editing={
                narrow
                  ? undefined
                  : {
                      selected,
                      onSelect: (path) => setSelected(path ? pathKey(path) : null),
                      onChange: (path, step, key) => actions.change(path, step, key),
                    }
              }
            />
          </div>
          <p className="lede chart-note">
            {narrow
              ? "Edit the chart on a wider screen. Every step can be edited below."
              : "Click a bar to edit its step. Drag its top to change the target and its right edge to change its length, or use the arrow keys: ↑↓ change the target, Alt with ←→ changes the length."}
          </p>
        </section>

        <section aria-labelledby="editor-steps" className="editor-steps-section">
          <div className="steps-head">
            <h2 id="editor-steps" className="section-title">
              Steps
            </h2>
            {checked.size > 0 && (
              <div className="selection-bar" role="toolbar" aria-label="Selected steps">
                <span className="muted">{checked.size} selected</span>
                <button
                  type="button"
                  className="secondary compact"
                  disabled={!canGroup}
                  onClick={groupChecked}
                  title={canGroup ? undefined : "Select steps next to each other at the same level"}
                >
                  Make a repeat
                </button>
                <button type="button" className="secondary compact" onClick={deleteChecked}>
                  Delete
                </button>
                <button
                  type="button"
                  className="quiet compact"
                  onClick={() => setChecked(new Set())}
                >
                  Clear
                </button>
              </div>
            )}
          </div>
          {byPath
            .get("")
            ?.filter((problem) => problem.field !== "name")
            .map((problem, index) => (
              <p key={index} role="alert" className="notice">
                {problem.message}
              </p>
            ))}
          <StepTree
            blocks={draft.steps}
            prefix={[]}
            context={{
              sport: draft.sport,
              reference,
              overview,
              selected,
              checked,
              problems: byPath,
              actions,
            }}
          />
          <div className="steps-foot">
            <button type="button" className="secondary" onClick={() => actions.addStep([])}>
              Add step
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                const at = [draft.steps.length];
                apply((current) => ({
                  ...current,
                  steps: [
                    ...current.steps,
                    {
                      type: "repeat",
                      count: 4,
                      steps: [
                        {
                          ...newStep(current.sport),
                          duration:
                            current.sport === "swimming"
                              ? { type: "distance", meters: 100 }
                              : { type: "time", seconds: 60 },
                        },
                        {
                          ...newStep(current.sport),
                          duration:
                            current.sport === "swimming"
                              ? { type: "distance", meters: 50 }
                              : { type: "time", seconds: 60 },
                        },
                      ],
                    },
                  ],
                }));
                reveal([...at, 0]);
              }}
            >
              Add repeat
            </button>
          </div>
        </section>
      </main>
    </FieldErrorsProvider>
  );
}

function focusedControl() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const buttons = active.closest(".block-buttons");
  return buttons ? [...buttons.children].indexOf(active) : null;
}

function focusBlock(path: Path, control: number | null) {
  const block = document.querySelector(`[data-path="${pathKey(path)}"]`);
  const row = block?.querySelector(":scope > .block-row");
  const buttons = [...(row?.querySelectorAll<HTMLButtonElement>(".block-buttons button") ?? [])];
  const preferred = control === null ? undefined : buttons[control];
  const target =
    preferred && !preferred.disabled
      ? preferred
      : (buttons.find((button) => !button.disabled) ??
        row?.querySelector<HTMLElement>(".block-summary, input"));
  target?.focus();
}

function ConflictPanel({
  conflict,
  onKeepMine,
  canKeepMine,
  onKeepTheirs,
  onSaveAsNew,
  onDiscard,
}: {
  conflict: Conflict;
  onKeepMine: () => void;
  canKeepMine: boolean;
  onKeepTheirs: (stored: StoredWorkout) => void;
  onSaveAsNew: () => void;
  onDiscard: () => void;
}) {
  if (conflict.kind === "deleted") {
    return (
      <div className="conflict" role="alert">
        <p className="state-title">This workout was deleted on another device.</p>
        <p className="lede">
          A deleted workout stays deleted. Your changes are still here: save them as a new workout,
          or leave them.
        </p>
        <div className="form-actions">
          <button type="button" className="primary compact" onClick={onSaveAsNew}>
            Keep as a new workout
          </button>
          <button type="button" className="quiet compact" onClick={onDiscard}>
            Discard my changes
          </button>
        </div>
      </div>
    );
  }
  const when = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  }).format(conflict.stored.updatedAt);
  return (
    <div className="conflict" role="alert">
      <p className="state-title">
        {conflict.kind === "changed"
          ? "This workout changed on another device."
          : "Another device saved a later edit."}
      </p>
      <p className="lede">
        {conflict.kind === "changed"
          ? `It was edited at ${when}, after you opened it. Saving now would replace that edit.`
          : `Its edit from ${when} is later than yours, so Trainstack kept it.`}{" "}
        Keep yours to replace it, or take theirs. Undo brings yours back.
      </p>
      <div className="form-actions">
        <button
          type="button"
          className="primary compact"
          onClick={onKeepMine}
          disabled={!canKeepMine}
        >
          Keep mine
        </button>
        <button
          type="button"
          className="secondary compact"
          onClick={() => onKeepTheirs(conflict.stored)}
        >
          Take theirs
        </button>
      </div>
    </div>
  );
}
