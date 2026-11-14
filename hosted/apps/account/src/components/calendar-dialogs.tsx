import type {
  BuiltinWorkoutSummary,
  CalendarDay,
  PlannedContent,
  PlannedWorkout,
  WorkoutSummary,
} from "@trainstack/contract";
import type { Workout } from "@trainstack/workout";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { api, queryClient } from "../api";
import {
  type CalendarRange,
  dayInFull,
  dayInShort,
  endOfDay,
  isDay,
  plannedName,
  rangeKey,
  weekCopies,
} from "../lib/calendar";
import { mondayOf } from "../lib/dates";
import { sportName } from "../lib/sports";
import { shiftDay } from "../lib/training";
import { formatMinutes, overviewOf, sportNames } from "../lib/workout-profile";
import { calendarWrites, useReferenceOn } from "./calendar-data";
import { PeriodPicker } from "./period-picker";
import { SportIcon } from "./sport-icon";
import { WorkoutThumb } from "./workout-chart";
import { builtinsKey, useBuiltins, useWorkoutSearch } from "./workout-data";

export type DialogRequest =
  | { readonly kind: "plan"; readonly day: CalendarDay }
  | { readonly kind: "copy" | "skip" | "delete"; readonly item: PlannedWorkout }
  | { readonly kind: "copy-week"; readonly start: string };

export function CalendarDialog({
  request,
  range,
  onClose,
}: {
  request: DialogRequest;
  range: CalendarRange;
  onClose: () => void;
}) {
  switch (request.kind) {
    case "plan":
      return <PlanDialog day={request.day} today={range.today} onClose={onClose} />;
    case "copy":
      return <CopyDialog item={request.item} today={range.today} onClose={onClose} />;
    case "copy-week":
      return <CopyWeekDialog start={request.start} range={range} onClose={onClose} />;
    case "skip":
      return <SkipDialog item={request.item} onClose={onClose} />;
    case "delete":
      return <DeleteDialog item={request.item} onClose={onClose} />;
  }
}

export function Modal({
  title,
  className,
  onClose,
  children,
}: {
  title: string;
  className?: string;
  onClose: () => void;
  children: (titleId: string) => ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`confirm ${className ?? ""}`}
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <h2 id={titleId}>{title}</h2>
      {children(titleId)}
    </dialog>
  );
}

async function rangeOf(from: string, through: string) {
  const range = await queryClient.fetchQuery({
    queryKey: rangeKey(from, through),
    queryFn: () => api.calendar.range({ from, through }),
    staleTime: 5_000,
  });
  return calendarWrites.view(range);
}

const tabs = [
  { key: "mine", label: "Your workouts" },
  { key: "builtin", label: "Built-in" },
  { key: "note", label: "Note" },
  { key: "rest", label: "Rest day" },
] as const;

type Tab = (typeof tabs)[number]["key"];

function useDebounced(value: string, ms = 200) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

function PlanDialog({
  day,
  today,
  onClose,
}: {
  day: CalendarDay;
  today: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("mine");
  const [failed, setFailed] = useState(false);
  const plan = (content: PlannedContent) => {
    void calendarWrites.plan(
      { id: crypto.randomUUID(), day: day.day, position: endOfDay(day.planned), content },
      today,
    );
    onClose();
  };
  return (
    <Modal title={`Plan on ${dayInFull(day.day)}`} className="plan-dialog" onClose={onClose}>
      {() => (
        <>
          <PeriodPicker label="What to plan" options={tabs} value={tab} onChange={setTab} />
          {failed && (
            <p role="alert" className="notice">
              That workout did not load. Check your connection and try again.
            </p>
          )}
          {tab === "mine" && (
            <OwnPicker
              day={day.day}
              onPick={async (summary) => {
                setFailed(false);
                try {
                  const stored = await api.workouts.get({ id: summary.id });
                  plan({
                    kind: "workout",
                    workout: stored.workout,
                    source: { kind: "library", id: stored.id, updatedAt: stored.updatedAt },
                    notes: null,
                  });
                } catch {
                  setFailed(true);
                }
              }}
            />
          )}
          {tab === "builtin" && (
            <BuiltinPicker
              day={day.day}
              onPick={async (summary) => {
                setFailed(false);
                try {
                  const full = await queryClient.fetchQuery({
                    queryKey: [...builtinsKey, summary.id],
                    queryFn: () => api.builtinWorkouts.get({ id: summary.id }),
                    staleTime: Infinity,
                  });
                  plan({
                    kind: "workout",
                    workout: full.workout,
                    source: { kind: "builtin", id: full.id },
                    notes: null,
                  });
                } catch {
                  setFailed(true);
                }
              }}
            />
          )}
          {tab === "note" && <NoteForm onCancel={onClose} onPlan={plan} />}
          {tab === "rest" && <RestForm onCancel={onClose} onPlan={plan} />}
        </>
      )}
    </Modal>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="field pick-search">
      <span className="visually-hidden">Search workouts</span>
      <input
        type="search"
        value={value}
        autoFocus
        placeholder="Search by name or tag"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function OwnPicker({
  day,
  onPick,
}: {
  day: string;
  onPick: (summary: WorkoutSummary) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const query = useDebounced(text.trim());
  const { search, summaries, library } = useWorkoutSearch(query ? { query } : {}, "updated");
  return (
    <>
      <SearchField value={text} onChange={setText} />
      {search.isPending ? (
        <p className="lede pick-status">Loading your workouts…</p>
      ) : search.isError ? (
        <p role="alert" className="notice pick-status">
          Your workouts did not load. Close this and try again.
        </p>
      ) : summaries.length === 0 ? (
        <p className="lede pick-status">
          {query
            ? "None of your workouts match."
            : "Your library is empty. Try the built-in workouts."}
        </p>
      ) : (
        <ul className="pick-list">
          {summaries.map((summary) => (
            <li key={summary.id}>
              <PickRow
                day={day}
                summary={summary}
                workout={library.data?.workouts[summary.id]?.workout}
                onPick={() => onPick(summary)}
              />
            </li>
          ))}
        </ul>
      )}
      {search.hasNextPage && (
        <button
          type="button"
          className="quiet compact"
          onClick={() => search.fetchNextPage()}
          disabled={search.isFetchingNextPage}
        >
          Show more
        </button>
      )}
    </>
  );
}

function BuiltinPicker({
  day,
  onPick,
}: {
  day: string;
  onPick: (summary: BuiltinWorkoutSummary) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const query = useDebounced(text.trim());
  const builtins = useBuiltins(query ? { query } : {}, "library");
  return (
    <>
      <SearchField value={text} onChange={setText} />
      {builtins.isPending ? (
        <p className="lede pick-status">Loading the built-in workouts…</p>
      ) : builtins.isError ? (
        <p role="alert" className="notice pick-status">
          The built-in workouts did not load. Close this and try again.
        </p>
      ) : builtins.data.workouts.length === 0 ? (
        <p className="lede pick-status">No built-in workouts match.</p>
      ) : (
        <ul className="pick-list">
          {builtins.data.workouts.map((summary) => (
            <li key={summary.id}>
              <PickRow
                day={day}
                summary={summary}
                workout={undefined}
                onPick={() => onPick(summary)}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PickRow({
  day,
  summary,
  workout,
  onPick,
}: {
  day: string;
  summary: Pick<WorkoutSummary, "name" | "sport" | "totals">;
  workout: Workout | undefined;
  onPick: () => Promise<void>;
}) {
  const referenceOn = useReferenceOn();
  const [busy, setBusy] = useState(false);
  const overview = workout ? overviewOf(workout, referenceOn(day, summary.sport)) : null;
  return (
    <button
      type="button"
      className="pick-row"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await onPick();
        setBusy(false);
      }}
    >
      <span className="pick-profile">
        {overview ? (
          <WorkoutThumb overview={overview} />
        ) : (
          <SportIcon family={sportName(summary.sport).family} />
        )}
      </span>
      <span className="pick-main">
        <span className="pick-name">{summary.name}</span>
        <span className="pick-meta">
          {sportNames[summary.sport]}, {formatMinutes(overview?.seconds ?? summary.totals.seconds)}
          {overview?.load ? `, ${overview.load.score} load` : ""}
        </span>
      </span>
    </button>
  );
}

function NoteForm({
  onCancel,
  onPlan,
}: {
  onCancel: () => void;
  onPlan: (content: PlannedContent) => void;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    onPlan({ kind: "note", title: title.trim(), notes: notes.trim() || null });
  }
  return (
    <form className="plan-form" onSubmit={submit}>
      <label className="field">
        <span>Title</span>
        <input
          value={title}
          maxLength={200}
          autoFocus
          required
          placeholder="Race day, travel, team ride"
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea
          rows={3}
          value={notes}
          maxLength={4000}
          onChange={(event) => setNotes(event.currentTarget.value)}
        />
      </label>
      <div className="confirm-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!title.trim()}>
          Add note
        </button>
      </div>
    </form>
  );
}

function RestForm({
  onCancel,
  onPlan,
}: {
  onCancel: () => void;
  onPlan: (content: PlannedContent) => void;
}) {
  const [notes, setNotes] = useState("");
  return (
    <form
      className="plan-form"
      onSubmit={(event) => {
        event.preventDefault();
        onPlan({ kind: "rest", notes: notes.trim() || null });
      }}
    >
      <label className="field">
        <span>Notes, if any</span>
        <textarea
          rows={3}
          value={notes}
          maxLength={4000}
          placeholder="Easy walk only"
          onChange={(event) => setNotes(event.currentTarget.value)}
        />
      </label>
      <div className="confirm-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" autoFocus>
          Add rest day
        </button>
      </div>
    </form>
  );
}

function DayField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (day: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="date"
        value={value}
        required
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

export function CopyDialog({
  item,
  today,
  onClose,
}: {
  item: PlannedWorkout;
  today: string;
  onClose: () => void;
}) {
  const [day, setDay] = useState(() => shiftDay(item.day, 7));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!isDay(day)) return;
    setBusy(true);
    setFailed(false);
    try {
      const target = await rangeOf(day, day);
      void calendarWrites.plan(
        {
          id: crypto.randomUUID(),
          day,
          position: endOfDay(target.days[0]?.planned ?? []),
          content: structuredClone(item.content),
        },
        today,
      );
      onClose();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  return (
    <Modal title={`Copy ${plannedName(item.content)}`} onClose={onClose}>
      {() => (
        <form onSubmit={submit} className="plan-form">
          <p className="lede">
            The copy goes after anything already planned that day. It starts as planned, not
            skipped.
          </p>
          <DayField label="Copy to" value={day} onChange={setDay} />
          {failed && (
            <p role="alert" className="notice">
              It was not copied. Check your connection and try again.
            </p>
          )}
          <div className="confirm-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy || !isDay(day)}>
              {busy ? "Copying…" : `Copy to ${isDay(day) ? dayInShort(day) : "that day"}`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function CopyWeekDialog({
  start,
  range,
  onClose,
}: {
  start: string;
  range: CalendarRange;
  onClose: () => void;
}) {
  const [day, setDay] = useState(() => shiftDay(start, 7));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const source = range.days.filter((entry) => mondayOf(entry.day) === start);
  const count = source.reduce((sum, entry) => sum + entry.planned.length, 0);
  const target = isDay(day) ? mondayOf(day) : null;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!target || target === start) return;
    setBusy(true);
    setFailed(false);
    try {
      const into = await rangeOf(target, shiftDay(target, 6));
      for (const copy of weekCopies(source, into.days, () => crypto.randomUUID())) {
        void calendarWrites.plan(copy, range.today);
      }
      onClose();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  return (
    <Modal title={`Copy the week of ${dayInShort(start)}`} onClose={onClose}>
      {() => (
        <form onSubmit={submit} className="plan-form">
          <p className="lede">
            {count === 1 ? "Its one planned item goes" : `Its ${count} planned items go`} to the
            same weekdays of the week you pick, after anything already planned there.
          </p>
          <DayField label="Any day of the week to copy to" value={day} onChange={setDay} />
          {target === start && <p className="notice">Pick another week.</p>}
          {failed && (
            <p role="alert" className="notice">
              The week was not copied. Check your connection and try again.
            </p>
          )}
          <div className="confirm-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy || !target || target === start || count === 0}
            >
              {busy ? "Copying…" : target ? `Copy to the week of ${dayInShort(target)}` : "Copy"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function SkipDialog({ item, onClose }: { item: PlannedWorkout; onClose: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal title={`Skip ${plannedName(item.content)}?`} onClose={onClose}>
      {() => (
        <form
          className="plan-form"
          onSubmit={(event) => {
            event.preventDefault();
            void calendarWrites.skip(item, { reason: reason.trim() || null });
            onClose();
          }}
        >
          <p className="lede">
            It stays on {dayInShort(item.day)}, marked skipped, so the week still shows what was
            planned.
          </p>
          <label className="field">
            <span>Why, if you want to note it</span>
            <textarea
              rows={2}
              value={reason}
              maxLength={500}
              autoFocus
              placeholder="Ill, travel, legs were done"
              onChange={(event) => setReason(event.currentTarget.value)}
            />
          </label>
          <div className="confirm-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary">
              Skip it
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function DeleteDialog({
  item,
  onClose,
  onDeleted,
}: {
  item: PlannedWorkout;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  return (
    <Modal title={`Delete ${plannedName(item.content)}?`} onClose={onClose}>
      {() => (
        <>
          <p className="lede">
            It comes off {dayInShort(item.day)} on every device.
            {item.content.kind === "workout" && item.content.source?.kind === "library"
              ? " The workout stays in your library."
              : ""}
          </p>
          <div className="confirm-actions">
            <button type="button" className="secondary" autoFocus onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="destructive"
              onClick={() => {
                void calendarWrites.remove(item);
                onClose();
                onDeleted?.();
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
