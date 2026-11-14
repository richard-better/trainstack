import { ORPCError } from "@orpc/client";
import {
  type PlannedContent,
  type PlannedWorkout,
  plannedWorkoutIdSchema,
} from "@trainstack/contract";
import type { Workout } from "@trainstack/workout";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { dayInFull, plannedName } from "../lib/calendar";
import { savePlannedWorkout } from "../lib/calendar-writes";
import { mondayOf } from "../lib/dates";
import { sportName } from "../lib/sports";
import { formatHours, formatLoad } from "../lib/statistics";
import { todayIn } from "../lib/time-zone";
import { formatMeters, overviewOf, sportNames } from "../lib/workout-profile";
import { CalendarIcon } from "./calendar-icons";
import { calendarWrites, usePlanned, useReferenceOn, useWritesVersion } from "./calendar-data";
import { CopyDialog, DeleteDialog, SkipDialog } from "./calendar-dialogs";
import { SportIcon } from "./sport-icon";
import { useAthleteSettings } from "./time-zone";
import { useHighlight, WorkoutChart } from "./workout-chart";
import { BackArrow, type EditorTarget, WorkoutEditor } from "./workout-editor";
import { ReferenceNote } from "./workout-page";
import { WorkoutSteps } from "./workout-steps";

function CalendarBack({ day }: { day: string | null }) {
  return (
    <Link to="/calendar" search={day ? { view: "week", at: mondayOf(day) } : {}} className="back">
      <BackArrow />
      Calendar
    </Link>
  );
}

function Frame({ day, children }: { day: string | null; children: ReactNode }) {
  return (
    <main className="content detail planned-detail">
      <CalendarBack day={day} />
      {children}
    </main>
  );
}

const isGone = (error: unknown) =>
  error instanceof ORPCError &&
  (error.code === "NOT_FOUND" || error.code === "PLANNED_WORKOUT_DELETED");

function usePlannedItem(id: string) {
  const valid = plannedWorkoutIdSchema.safeParse(id).success;
  const query = usePlanned(valid ? id : "00000000-0000-4000-8000-000000000000");
  const settings = useAthleteSettings();
  const today = todayIn(settings.data?.timeZone ?? null);
  useWritesVersion();
  const item = valid ? calendarWrites.viewItem(query.data ?? null, id, today) : null;
  const gone = !valid || isGone(query.error) || (query.data !== undefined && item === null);
  return { item, query, gone };
}

function Unavailable({ gone, retry }: { gone: boolean; retry: () => void }) {
  return (
    <Frame day={null}>
      {gone ? (
        <div className="state" role="alert">
          <p className="state-title">This planned workout is not on your calendar.</p>
          <p className="lede">It may have been deleted on another device.</p>
          <Link to="/calendar" search={{}} className="secondary link-button">
            Go to your calendar
          </Link>
        </div>
      ) : (
        <div className="state" role="alert">
          <p className="state-title">This planned workout did not load.</p>
          <p className="lede">Check your connection and try again.</p>
          <button type="button" className="secondary" onClick={retry}>
            Try again
          </button>
        </div>
      )}
    </Frame>
  );
}

function Loading() {
  return (
    <Frame day={null}>
      <div className="detail-head skeleton" aria-busy="true" aria-label="Loading planned workout">
        <span className="bar" style={{ width: "30%" }} />
        <span className="bar tall" style={{ width: "55%" }} />
      </div>
    </Frame>
  );
}

export function PlannedPage({ id }: { id: string }) {
  const { item, query, gone } = usePlannedItem(id);
  if (item) return <PlannedView item={item} />;
  if (gone || query.isError) return <Unavailable gone={gone} retry={() => query.refetch()} />;
  return <Loading />;
}

function stateText(item: PlannedWorkout) {
  switch (item.state) {
    case "skipped":
      return "Skipped";
    case "missed":
      return "Missed";
    default:
      return item.content.kind === "workout" ? "Planned" : null;
  }
}

function sourceLink(content: PlannedContent) {
  if (content.kind !== "workout" || !content.source) return null;
  return content.source.kind === "library" ? (
    <Link to="/workouts/$id" params={{ id: content.source.id }} className="text-link">
      Copied from your library
    </Link>
  ) : (
    <Link to="/workouts/builtin/$id" params={{ id: content.source.id }} className="text-link">
      Copied from a built-in workout
    </Link>
  );
}

function PlannedView({ item }: { item: PlannedWorkout }) {
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"copy" | "skip" | "delete" | null>(null);
  const settings = useAthleteSettings();
  const today = todayIn(settings.data?.timeZone ?? null);
  const name = plannedName(item.content);
  const state = stateText(item);

  useEffect(() => {
    document.title = `${name} - Trainstack`;
    return () => {
      document.title = "Trainstack";
    };
  }, [name]);

  return (
    <Frame day={item.day}>
      <header className="detail-head">
        <p className="detail-meta">
          {item.content.kind === "workout" && (
            <span className="detail-sport">
              <SportIcon family={sportName(item.content.workout.sport).family} />
              {sportNames[item.content.workout.sport]}
            </span>
          )}
          <time dateTime={item.day}>{dayInFull(item.day)}</time>
          {state && (
            <span className="planned-state" data-state={item.state}>
              {item.state === "skipped" && <CalendarIcon name="skipped" size={12} />}
              {item.state === "missed" && <CalendarIcon name="missed" size={12} />}
              {state}
            </span>
          )}
          {sourceLink(item.content)}
        </p>
        <h1 className="detail-title">{name}</h1>
        <div className="actions">
          {item.content.kind === "workout" && (
            <Link
              to="/calendar/planned/$id/edit"
              params={{ id: item.id }}
              className="secondary link-button"
            >
              Edit this copy
            </Link>
          )}
          {item.content.kind === "workout" &&
            (item.skipped ? (
              <button
                type="button"
                className="secondary"
                onClick={() => void calendarWrites.skip(item, null)}
              >
                Mark not skipped
              </button>
            ) : (
              <button type="button" className="secondary" onClick={() => setDialog("skip")}>
                Skip
              </button>
            ))}
          <button type="button" className="secondary" onClick={() => setDialog("copy")}>
            Copy to another day
          </button>
          <button type="button" className="secondary danger" onClick={() => setDialog("delete")}>
            Delete
          </button>
        </div>
      </header>

      {item.skipped && (
        <p className="note skipped-note">
          You skipped this{item.skipped.reason ? `: ${item.skipped.reason}` : "."}
        </p>
      )}

      {item.content.kind === "workout" && (
        <PlannedWorkoutBody item={item} workout={item.content.workout} />
      )}

      <NotesForm key={`${item.id}-${item.updatedAt.getTime()}`} item={item} />

      {dialog === "copy" && (
        <CopyDialog item={item} today={today} onClose={() => setDialog(null)} />
      )}
      {dialog === "skip" && <SkipDialog item={item} onClose={() => setDialog(null)} />}
      {dialog === "delete" && (
        <DeleteDialog
          item={item}
          onClose={() => setDialog(null)}
          onDeleted={() =>
            void navigate({ to: "/calendar", search: { view: "week", at: mondayOf(item.day) } })
          }
        />
      )}
    </Frame>
  );
}

function PlannedWorkoutBody({ item, workout }: { item: PlannedWorkout; workout: Workout }) {
  const referenceOn = useReferenceOn();
  const reference = referenceOn(item.day, workout.sport);
  const overview = useMemo(() => overviewOf(workout, reference), [workout, reference]);
  const { highlight, setHighlight } = useHighlight();
  const seconds = item.planned?.seconds ?? overview.seconds;
  const meters = item.planned?.meters ?? (overview.meters > 0 ? overview.meters : null);
  const load = item.planned?.load ?? overview.load?.score ?? null;
  return (
    <>
      <dl className="figures">
        <div className="figure">
          <dt>Duration</dt>
          <dd>{formatHours(seconds)}</dd>
        </div>
        {meters !== null && (
          <div className="figure">
            <dt>Distance</dt>
            <dd>{formatMeters(meters)}</dd>
          </div>
        )}
        <div className="figure">
          <dt>Load</dt>
          <dd>{load === null ? "-" : formatLoad(load)}</dd>
        </div>
      </dl>
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
      <section aria-labelledby="steps-title" className="workout-section">
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
    </>
  );
}

function NotesForm({ item }: { item: PlannedWorkout }) {
  const { content } = item;
  const [title, setTitle] = useState(content.kind === "note" ? content.title : "");
  const [notes, setNotes] = useState(content.notes ?? "");
  const changed =
    (content.notes ?? "") !== notes || (content.kind === "note" && content.title !== title);
  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = notes.trim() || null;
    if (content.kind === "note") {
      if (!title.trim()) return;
      void calendarWrites.change(item, { ...content, title: title.trim(), notes: trimmed });
    } else {
      void calendarWrites.change(item, { ...content, notes: trimmed });
    }
  }
  return (
    <section aria-labelledby="notes-title" className="workout-section planned-notes">
      <h2 id="notes-title" className="section-title">
        Notes
      </h2>
      <form className="plan-form" onSubmit={submit}>
        {content.kind === "note" && (
          <label className="field">
            <span>Title</span>
            <input
              value={title}
              maxLength={200}
              required
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </label>
        )}
        <label className="field">
          <span className="visually-hidden">Notes</span>
          <textarea
            rows={3}
            value={notes}
            maxLength={4000}
            placeholder={content.kind === "workout" ? "How to ride it, what to eat, where" : ""}
            onChange={(event) => setNotes(event.currentTarget.value)}
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="secondary compact" disabled={!changed}>
            Save notes
          </button>
        </div>
      </form>
    </section>
  );
}

type PlannedSaved = {
  readonly workout: Workout;
  readonly updatedAt: Date;
  readonly planned: PlannedWorkout;
};

const savedOf = (planned: PlannedWorkout): PlannedSaved | null =>
  planned.content.kind === "workout"
    ? { workout: planned.content.workout, updatedAt: planned.updatedAt, planned }
    : null;

export function PlannedEditPage({ id }: { id: string }) {
  const { item, query, gone } = usePlannedItem(id);
  const [opened, setOpened] = useState<PlannedSaved | null>(null);
  const navigate = useNavigate();
  if (item && item.id === id && opened?.planned.id !== id) {
    const saved = savedOf(item);
    if (saved) setOpened(saved);
  }
  const target = useMemo(
    () => (opened ? plannedTarget(opened.planned, navigate) : null),
    [opened, navigate],
  );
  if (opened && target) {
    return (
      <WorkoutEditor key={id} id={id} initial={opened.workout} base={opened} target={target} />
    );
  }
  if (item && item.content.kind !== "workout") {
    return (
      <Frame day={item.day}>
        <div className="state" role="alert">
          <p className="state-title">Only a planned workout has steps to edit.</p>
          <Link to="/calendar/planned/$id" params={{ id }} className="secondary link-button">
            Back to {plannedName(item.content)}
          </Link>
        </div>
      </Frame>
    );
  }
  if (gone || query.isError) return <Unavailable gone={gone} retry={() => query.refetch()} />;
  return <Loading />;
}

function plannedTarget(
  original: PlannedWorkout,
  navigate: ReturnType<typeof useNavigate>,
): EditorTarget<PlannedSaved> {
  return {
    save: async ({ id, workout, base, overwrite }) => {
      if (base) {
        const outcome = await savePlannedWorkout(api, { base: base.planned, workout, overwrite });
        if (outcome.kind === "deleted" || outcome.kind === "refused") return outcome;
        const saved = savedOf(outcome.stored);
        return saved ? { kind: outcome.kind, stored: saved } : { kind: "deleted" };
      }
      const content: PlannedContent =
        original.content.kind === "workout"
          ? { ...original.content, workout }
          : { kind: "workout", workout, source: null, notes: null };
      const stored = await api.plannedWorkouts.put({
        id,
        day: original.day,
        position: original.position,
        content,
        planId: null,
        updatedAt: new Date(),
      });
      return { kind: "saved", stored: savedOf(stored)! };
    },
    remember: async (stored, first) => {
      await calendarWrites.remember(stored.planned);
      if (first) {
        void navigate({
          to: "/calendar/planned/$id/edit",
          params: { id: stored.planned.id },
          replace: true,
        });
      }
    },
    forget: (id) => calendarWrites.remember({ id, deletedAt: new Date() }),
    back: (id, saved) =>
      saved ? (
        <Link to="/calendar/planned/$id" params={{ id }} className="back">
          <BackArrow />
          Back to the planned workout
        </Link>
      ) : (
        <CalendarBack day={original.day} />
      ),
    discard: () =>
      void navigate({ to: "/calendar", search: { view: "week", at: mondayOf(original.day) } }),
    firstSave: "Plan it again",
    deleted: {
      title: "This planned workout was deleted on another device.",
      lede: `A deleted planned workout stays deleted. Your changes are still here: plan them again on ${dayInFull(original.day)}, or leave them.`,
      keep: "Plan it again",
    },
  };
}
