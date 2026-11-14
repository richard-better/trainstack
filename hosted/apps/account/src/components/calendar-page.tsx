import type {
  CalendarActivity,
  CalendarDay,
  CalendarTotals,
  PlannedWorkout,
} from "@trainstack/contract";
import type { Sport } from "@trainstack/workout";
import { Link, useNavigate } from "@tanstack/react-router";
import { type DragEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import {
  type CalendarRange,
  type CalendarView,
  type Nudge,
  type Period,
  type Spot,
  anchorContaining,
  dayInFull,
  dayInShort,
  findPlanned,
  isInMonth,
  meterOf,
  monthNameOf,
  moved,
  nudged,
  pairsOf,
  periodOf,
  placementFor,
  plannedName,
  shiftedAnchor,
  spotOf,
  totalsOf,
  weekdayNames,
  weekdayOf,
  weeksOf,
  withPlanned,
} from "../lib/calendar";
import { weekLabel } from "../lib/dates";
import { storedRouteSegments, routePath } from "../lib/route";
import { activityTitle, sportName } from "../lib/sports";
import { formatDistance, formatHours, formatLoad } from "../lib/statistics";
import { todayIn } from "../lib/time-zone";
import { overviewOf, type Reference } from "../lib/workout-profile";
import { CalendarIcon } from "./calendar-icons";
import { ComplianceBadge } from "./compliance";
import { calendarWrites, useCalendar, useReferenceOn, useWritesVersion } from "./calendar-data";
import { CalendarDialog, type DialogRequest } from "./calendar-dialogs";
import { PeriodPicker } from "./period-picker";
import { SportIcon } from "./sport-icon";
import { TimeZoneOffer, useAthleteSettings } from "./time-zone";
import { WorkoutThumb } from "./workout-chart";

type ReferenceOn = (day: string, sport: Sport) => Reference;

const viewOptions = [
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
] as const;

const NUDGES: Record<string, Nudge> = {
  ArrowLeft: "previous-day",
  ArrowRight: "next-day",
  ArrowUp: "earlier",
  ArrowDown: "later",
  PageUp: "previous-week",
  PageDown: "next-week",
};

function typingInto(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

const anyDialogOpen = () => document.querySelector("dialog[open]") !== null;

function focusPlanned(id: string) {
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>(`[data-planned-id="${id}"] .plan-link`)?.focus(),
  );
}

interface Moving {
  readonly id: string;
  readonly spot: Spot;
}

export function CalendarPage({ view, at }: { view: CalendarView; at: string | undefined }) {
  const navigate = useNavigate({ from: "/calendar/" });
  const settings = useAthleteSettings();
  const [knownToday, setKnownToday] = useState<string | null>(null);
  const today = knownToday ?? todayIn(settings.data?.timeZone ?? null);
  const period = periodOf(view, at, today);
  const { query, range } = useCalendar(period);
  const referenceOn = useReferenceOn();
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [moving, setMoving] = useState<Moving | null>(null);
  const [drag, setDrag] = useState<{ id: string; spot: Spot | null } | null>(null);

  useEffect(() => {
    if (query.data && query.data.today !== knownToday) setKnownToday(query.data.today);
  }, [query.data, knownToday]);

  const showing = range && range.days[0]?.day === period.from ? range : undefined;
  const isCurrent = period.at === periodOf(view, undefined, today).at;

  function go(next: { view?: CalendarView; at?: string | undefined }) {
    setMoving(null);
    void navigate({ search: (search) => ({ ...search, view: next.view ?? view, at: next.at }) });
  }

  const step = (by: number) => go({ at: shiftedAnchor(period, by) });
  const switchTo = (next: CalendarView) =>
    go({
      view: next,
      at: anchorContaining(next, isInMonth(period, today) && isCurrent ? today : period.from),
    });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (moving || event.metaKey || event.ctrlKey || event.altKey) return;
      if (typingInto(event.target) || anyDialogOpen()) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (
          event.target instanceof HTMLElement &&
          event.target.closest("[role=radiogroup], fieldset")
        )
          return;
        event.preventDefault();
        step(event.key === "ArrowLeft" ? -1 : 1);
      } else if (event.key === "t") {
        go({ at: undefined });
      } else if (event.key === "m" || event.key === "w") {
        switchTo(event.key === "m" ? "month" : "week");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const shown = useMemo(() => {
    if (!showing || !moving) return showing;
    const item = findPlanned(showing, moving.id);
    const placement = placementFor(showing, moving.id, moving.spot.day, moving.spot.index);
    return item && placement
      ? withPlanned(showing, moved(item, placement, showing.today))
      : showing;
  }, [showing, moving]);

  useEffect(() => {
    if (!moving || !showing) return;
    const onKey = (event: KeyboardEvent) => {
      if (anyDialogOpen()) return;
      const nudge = view === "week" && event.key.startsWith("Page") ? undefined : NUDGES[event.key];
      if (nudge) {
        event.preventDefault();
        setMoving({ id: moving.id, spot: nudged(showing, moving.id, moving.spot, nudge) });
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        commitMove(moving.id, moving.spot);
        setMoving(null);
        focusPlanned(moving.id);
      } else if (event.key === "Escape") {
        event.preventDefault();
        setMoving(null);
        focusPlanned(moving.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function commitMove(id: string, spot: Spot) {
    if (!showing) return;
    const item = findPlanned(showing, id);
    const placement = placementFor(showing, id, spot.day, spot.index);
    if (item && placement) void calendarWrites.move(item, placement);
  }

  const actions: Actions = {
    plan: (day) => setDialog({ kind: "plan", day }),
    open: (item, kind) => setDialog({ kind, item }),
    copyWeek: (start) => setDialog({ kind: "copy-week", start }),
    unskip: (item) => void calendarWrites.skip(item, null),
    startMove: (item) => {
      if (!showing) return;
      const spot = spotOf(showing, item.id);
      if (spot) setMoving({ id: item.id, spot });
      focusPlanned(item.id);
    },
    drag: {
      state: drag,
      start: (id) => setDrag({ id, spot: null }),
      over: (spot) =>
        setDrag((current) =>
          current && (current.spot?.day !== spot.day || current.spot.index !== spot.index)
            ? { ...current, spot }
            : current,
        ),
      drop: () => {
        if (drag?.spot) commitMove(drag.id, drag.spot);
        setDrag(null);
      },
      end: () => setDrag(null),
    },
  };

  const movingItem = moving && shown ? findPlanned(shown, moving.id) : null;

  return (
    <main className="content calendar" data-view={view}>
      <div className="calendar-head">
        <h1 className="page-title calendar-title">
          <span className="visually-hidden">Calendar, </span>
          {period.label}
        </h1>
        <div className="calendar-controls">
          <PeriodPicker label="Show a" options={viewOptions} value={view} onChange={switchTo} />
          <div className="calendar-step">
            <button
              type="button"
              className="secondary step-button"
              onClick={() => step(-1)}
              aria-label={`Previous ${view}`}
              title={`Previous ${view} (←)`}
            >
              <CalendarIcon name="previous" />
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => go({ at: undefined })}
              disabled={isCurrent}
              title="Today (T)"
            >
              Today
            </button>
            <button
              type="button"
              className="secondary step-button"
              onClick={() => step(1)}
              aria-label={`Next ${view}`}
              title={`Next ${view} (→)`}
            >
              <CalendarIcon name="next" />
            </button>
          </div>
        </div>
      </div>
      <TimeZoneOffer where="calendar" />
      <Legend />
      <Notices />
      {movingItem && moving && shown && (
        <MoveBanner item={movingItem} spot={moving.spot} range={shown} view={view} />
      )}
      {shown ? (
        <CalendarGrid
          range={shown}
          period={period}
          referenceOn={referenceOn}
          movingId={moving?.id ?? null}
          actions={actions}
        />
      ) : query.isError ? (
        <div className="state" role="alert">
          <p className="state-title">Your calendar did not load.</p>
          <p className="lede">Check your connection and try again.</p>
          <button type="button" className="secondary" onClick={() => query.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <CalendarSkeleton view={view} />
      )}
      {dialog && showing && (
        <CalendarDialog request={dialog} range={showing} onClose={() => setDialog(null)} />
      )}
    </main>
  );
}

interface Actions {
  readonly plan: (day: CalendarDay) => void;
  readonly open: (item: PlannedWorkout, kind: "copy" | "move" | "skip" | "delete") => void;
  readonly copyWeek: (start: string) => void;
  readonly unskip: (item: PlannedWorkout) => void;
  readonly startMove: (item: PlannedWorkout) => void;
  readonly drag: {
    readonly state: { id: string; spot: Spot | null } | null;
    readonly start: (id: string) => void;
    readonly over: (spot: Spot) => void;
    readonly drop: () => void;
    readonly end: () => void;
  };
}

function Legend() {
  return (
    <ul className="calendar-legend" aria-label="What the marks mean">
      <li>
        <span className="legend-swatch" data-state="planned" aria-hidden="true" />
        Planned
      </li>
      <li>
        <span className="legend-swatch" data-state="done" aria-hidden="true" />
        Done
      </li>
      <li>
        <span className="legend-pair" aria-hidden="true" />
        Paired by you
      </li>
      <li>
        <span className="legend-pair" data-by="auto" aria-hidden="true" />
        Matched automatically
      </li>
      <li>
        <CalendarIcon name="skipped" size={12} />
        Skipped
      </li>
      <li>
        <CalendarIcon name="missed" size={12} />
        Missed
      </li>
    </ul>
  );
}

export function Notices() {
  useWritesVersion();
  const notices = calendarWrites.notices();
  const retrying = calendarWrites.retrying();
  if (notices.length === 0 && !retrying) return <div role="status" className="visually-hidden" />;
  return (
    <div className="calendar-notices" role="status">
      {retrying && (
        <p className="calendar-notice">
          <span className="lede">
            Some changes are not saved yet. Trainstack keeps trying, and tries again as soon as you
            are back online.
          </span>
        </p>
      )}
      {notices.map((notice) => (
        <div key={notice.key} className="calendar-notice" data-kind={notice.kind}>
          <p className="lede">{noticeText(notice)}</p>
          <div className="form-actions">
            {notice.kind === "overruled" && (
              <button
                type="button"
                className="secondary compact"
                onClick={() => {
                  calendarWrites.dismiss(notice.key);
                  notice.retry();
                }}
              >
                {notice.intended ? `Move it to ${dayInShort(notice.intended.day)}` : "Use mine"}
              </button>
            )}
            <button
              type="button"
              className="quiet compact"
              onClick={() => calendarWrites.dismiss(notice.key)}
            >
              {notice.kind !== "overruled"
                ? "OK"
                : notice.intended
                  ? "Leave it there"
                  : "Keep theirs"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function noticeText(notice: ReturnType<typeof calendarWrites.notices>[number]) {
  switch (notice.kind) {
    case "deleted":
      return `${notice.name} was deleted on another device, so it is off your calendar.`;
    case "refused":
      return `${notice.name}: ${notice.reason}`;
    case "overruled": {
      const name = plannedName(notice.item.content);
      switch (notice.write) {
        case "move":
          return `${name} was moved on another device after your move, so it stays on ${dayInShort(notice.item.day)}.`;
        case "skip":
          return `${name} was ${notice.item.skipped ? "marked skipped" : "marked not skipped"} on another device after your change, so that stands.`;
        case "change":
          return `${name} was changed on another device after your edit, so its version stands.`;
        case "pair":
          return `${name} was paired differently on another device after your choice, so that stands.`;
        case "unpair":
          return `${name} was paired again on another device after you took it apart, so that stands.`;
      }
    }
  }
}

function MoveBanner({
  item,
  spot,
  range,
  view,
}: {
  item: PlannedWorkout;
  spot: Spot;
  range: CalendarRange;
  view: CalendarView;
}) {
  const day = range.days.find((entry) => entry.day === spot.day);
  const count = day?.planned.length ?? 1;
  return (
    <div className="move-banner" role="status" aria-live="assertive">
      <CalendarIcon name="moving" />
      <p>
        Moving {plannedName(item.content)} to {dayInFull(spot.day)}, {spot.index + 1} of {count}.{" "}
        <span className="muted">
          ← → change the day, ↑ ↓ the order{view === "month" ? ", Page Up and Down the week" : ""}.
          Enter puts it here, Escape leaves it where it was. To go further, use Move to another day.
        </span>
      </p>
    </div>
  );
}

function CalendarSkeleton({ view }: { view: CalendarView }) {
  return (
    <div
      className="cal skeleton"
      data-view={view}
      aria-busy="true"
      aria-label="Loading your calendar"
    >
      {Array.from({ length: view === "week" ? 1 : 5 }, (_, week) => (
        <div key={week} className="cal-week">
          <div className="cal-days">
            {weekdayNames.map((name) => (
              <span key={name} className="cal-day skeleton-day" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CalendarGrid({
  range,
  period,
  referenceOn,
  movingId,
  actions,
}: {
  range: CalendarRange;
  period: Period;
  referenceOn: ReferenceOn;
  movingId: string | null;
  actions: Actions;
}) {
  const weeks = weeksOf(range);
  return (
    <div
      className="cal"
      data-view={period.view}
      data-dragging={actions.drag.state ? true : undefined}
    >
      <div className="cal-weekdays" aria-hidden="true">
        {weekdayNames.map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>
      {weeks.map((week) => (
        <section
          key={week.start}
          className="cal-week"
          aria-label={`Week of ${dayInFull(week.start)}`}
        >
          <ol className="cal-days">
            {week.days.map((day) => (
              <DayCell
                key={day.day}
                day={day}
                today={range.today}
                outside={!isInMonth(period, day.day)}
                referenceOn={referenceOn}
                movingId={movingId}
                actions={actions}
                detailed={period.view === "week"}
              />
            ))}
          </ol>
          <WeekTotals
            start={week.start}
            today={range.today}
            totals={totalsOf(range, week.start)}
            canCopy={week.days.some((day) => day.planned.length > 0)}
            onCopy={() => actions.copyWeek(week.start)}
          />
        </section>
      ))}
    </div>
  );
}

function dropIndex(event: DragEvent<HTMLElement>, draggedId: string) {
  const cards = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-planned-id]")].filter(
    (card) => card.dataset.plannedId !== draggedId,
  );
  return cards.filter((card) => {
    const box = card.getBoundingClientRect();
    return box.top + box.height / 2 < event.clientY;
  }).length;
}

function lineIndex(planned: readonly PlannedWorkout[], draggedId: string | undefined, at: number) {
  let others = 0;
  for (const [index, item] of planned.entries()) {
    if (item.id === draggedId) continue;
    if (others === at) return index;
    others += 1;
  }
  return planned.length;
}

function DayCell({
  day,
  today,
  outside,
  referenceOn,
  movingId,
  actions,
  detailed,
}: {
  day: CalendarDay;
  today: string;
  outside: boolean;
  referenceOn: ReferenceOn;
  movingId: string | null;
  actions: Actions;
  detailed: boolean;
}) {
  const isToday = day.day === today;
  const drag = actions.drag.state;
  const dropAt = drag?.spot?.day === day.day ? drag.spot.index : null;
  const empty = day.planned.length === 0 && day.activities.length === 0;
  const { planned, unplanned } = pairsOf(day);
  const items: ReactNode[] = planned.map(({ item, done }) => {
    const card = (
      <PlannedCard
        key={item.id}
        item={item}
        done={done}
        activities={day.activities}
        reference={
          item.content.kind === "workout" ? referenceOn(item.day, item.content.workout.sport) : null
        }
        moving={item.id === movingId}
        dragging={item.id === drag?.id}
        actions={actions}
        detailed={detailed}
      />
    );
    if (!done) return card;
    return (
      <li key={item.id} className="pair" data-by={item.pairing?.by}>
        <ul className="pair-items">
          {card}
          <ActivityCard activity={done} pairedBy={item.pairing?.by ?? "auto"} />
        </ul>
      </li>
    );
  });
  if (dropAt !== null) {
    items.splice(
      lineIndex(day.planned, drag?.id, dropAt),
      0,
      <li key="drop" className="drop-line" aria-hidden="true" />,
    );
  }
  return (
    <li
      className="cal-day"
      data-day={day.day}
      data-today={isToday || undefined}
      data-past={day.day < today || undefined}
      data-outside={outside || undefined}
      data-empty={empty || undefined}
      data-drop={dropAt !== null || undefined}
      onDragOver={(event) => {
        if (!drag) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        actions.drag.over({ day: day.day, index: dropIndex(event, drag.id) });
      }}
      onDrop={(event) => {
        if (!drag) return;
        event.preventDefault();
        actions.drag.drop();
      }}
    >
      <div className="day-head">
        <h3 className="day-date">
          <time dateTime={day.day} aria-current={isToday ? "date" : undefined}>
            <span className="day-weekday">{weekdayOf(day.day)}</span>
            <span className="day-number">{Number(day.day.slice(8))}</span>
            {(day.day.endsWith("-01") || outside) && (
              <span className="day-month">{monthNameOf(day.day)}</span>
            )}
          </time>
          {isToday && <span className="today-word">Today</span>}
        </h3>
        <button
          type="button"
          className="day-add quiet"
          onClick={() => actions.plan(day)}
          aria-label={`Plan on ${dayInFull(day.day)}`}
          title="Plan a workout, note or rest day"
        >
          <CalendarIcon name="plus" />
        </button>
      </div>
      {(items.length > 0 || day.activities.length > 0) && (
        <ul className="day-items">
          {items}
          {unplanned.map((activity) => (
            <ActivityCard key={activity.id} activity={activity} pairedBy={null} />
          ))}
        </ul>
      )}
    </li>
  );
}

function stateWords(item: PlannedWorkout) {
  switch (item.state) {
    case "skipped":
      return item.skipped?.reason ? `Skipped: ${item.skipped.reason}` : "Skipped";
    case "missed":
      return "Missed";
    case "completed":
      return "Done";
    default:
      return null;
  }
}

function PlannedCard({
  item,
  done,
  activities,
  reference,
  moving,
  dragging,
  actions,
  detailed,
}: {
  item: PlannedWorkout;
  done: CalendarActivity | null;
  activities: readonly CalendarActivity[];
  reference: Reference | null;
  moving: boolean;
  dragging: boolean;
  actions: Actions;
  detailed: boolean;
}) {
  const { content } = item;
  const overview =
    content.kind === "workout" && reference ? overviewOf(content.workout, reference) : null;
  const figures =
    content.kind === "workout"
      ? {
          seconds: item.planned
            ? item.planned.seconds
            : overview && overview.unknownLapSteps === 0
              ? overview.seconds
              : null,
          load: item.planned ? item.planned.load : (overview?.load?.score ?? null),
        }
      : null;
  const name = plannedName(content);
  const words = stateWords(item);
  const pending = calendarWrites.isPending(item.id);
  return (
    <li
      className="plan-card"
      data-planned-id={item.id}
      data-kind={content.kind}
      data-state={item.state}
      data-moving={moving || undefined}
      data-dragging={dragging || undefined}
      data-pending={pending || undefined}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.id);
        actions.drag.start(item.id);
      }}
      onDragEnd={() => actions.drag.end()}
    >
      <Link
        to="/calendar/planned/$id"
        params={{ id: item.id }}
        className="plan-link"
        draggable={false}
      >
        {overview && overview.segments.length > 0 && (
          <WorkoutThumb overview={overview} height={detailed ? 40 : 22} />
        )}
        <span className="plan-title">
          {content.kind === "workout" && (
            <span className="plan-sport" title={sportName(content.workout.sport).label}>
              <SportIcon family={sportName(content.workout.sport).family} />
            </span>
          )}
          {content.kind === "note" && <CalendarIcon name="note" />}
          {content.kind === "rest" && <CalendarIcon name="rest" />}
          <span className="plan-name">{name}</span>
        </span>
        {figures && (
          <span className="plan-meta">
            <span>{figures.seconds === null ? "time unknown" : formatHours(figures.seconds)}</span>
            <span>
              {figures.load === null ? "load unknown" : formatLoad(figures.load)}
              {figures.load !== null && <span className="unit"> load</span>}
            </span>
          </span>
        )}
        {content.kind !== "workout" && content.notes && (
          <span className="plan-notes">{content.notes}</span>
        )}
        {words && (
          <span className="plan-state">
            <CalendarIcon
              name={
                item.state === "skipped"
                  ? "skipped"
                  : item.state === "completed"
                    ? "done"
                    : "missed"
              }
              size={12}
            />
            {words}
          </span>
        )}
        <ComplianceBadge item={item} withWhy={detailed} />
        <span className="visually-hidden">
          {item.state === "planned" && content.kind === "workout" ? ", planned" : ""}
        </span>
      </Link>
      <PlannedMenu item={item} name={name} done={done} activities={activities} actions={actions} />
    </li>
  );
}

export function Menu({
  label,
  className,
  summary,
  children,
}: {
  label: string;
  className?: string;
  summary: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) ref.current?.removeAttribute("open");
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      ref.current?.removeAttribute("open");
      ref.current?.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const close = () => ref.current?.removeAttribute("open");
  return (
    <details
      ref={ref}
      className={`menu ${className ?? ""}`}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary aria-label={label} title={label}>
        {summary}
      </summary>
      {open && <div className="menu-panel">{children(close)}</div>}
    </details>
  );
}

function PlannedMenu({
  item,
  name,
  done,
  activities,
  actions,
}: {
  item: PlannedWorkout;
  name: string;
  done: CalendarActivity | null;
  activities: readonly CalendarActivity[];
  actions: Actions;
}) {
  return (
    <Menu label={`Change ${name}`} className="plan-menu" summary={<CalendarIcon name="more" />}>
      {(close) => (
        <>
          {done && (
            <button
              type="button"
              className="quiet menu-item"
              onClick={() => {
                close();
                void calendarWrites.unpair(item, done.id);
              }}
            >
              Unpair from {activityTitle(done)}
            </button>
          )}
          {item.content.kind === "workout" &&
            activities
              .filter((activity) => activity.id !== done?.id)
              .map((activity) => (
                <button
                  key={activity.id}
                  type="button"
                  className="quiet menu-item"
                  onClick={() => {
                    close();
                    void calendarWrites.pair(item, activity.id);
                  }}
                >
                  {done ? "Pair instead with" : "Pair with"} {activityTitle(activity)}
                </button>
              ))}
          <button
            type="button"
            className="quiet menu-item"
            onClick={() => {
              close();
              actions.startMove(item);
            }}
          >
            Move with the keyboard
          </button>
          <button
            type="button"
            className="quiet menu-item"
            onClick={() => {
              close();
              actions.open(item, "move");
            }}
          >
            Move to another day
          </button>
          <button
            type="button"
            className="quiet menu-item"
            onClick={() => {
              close();
              actions.open(item, "copy");
            }}
          >
            Copy to another day
          </button>
          {item.content.kind === "workout" &&
            (item.skipped ? (
              <button
                type="button"
                className="quiet menu-item"
                onClick={() => {
                  close();
                  actions.unskip(item);
                }}
              >
                Mark not skipped
              </button>
            ) : (
              <button
                type="button"
                className="quiet menu-item"
                onClick={() => {
                  close();
                  actions.open(item, "skip");
                }}
              >
                Skip
              </button>
            ))}
          <button
            type="button"
            className="quiet menu-item danger"
            onClick={() => {
              close();
              actions.open(item, "delete");
            }}
          >
            Delete
          </button>
        </>
      )}
    </Menu>
  );
}

const ROUTE_WIDTH = 48;
const ROUTE_HEIGHT = 32;

function RouteDrawing({ route }: { route: NonNullable<CalendarActivity["route"]> }) {
  const path = useMemo(
    () => routePath(storedRouteSegments(route), ROUTE_WIDTH, ROUTE_HEIGHT, 3),
    [route],
  );
  if (!path) return null;
  return (
    <svg
      className="done-route"
      viewBox={`0 0 ${ROUTE_WIDTH} ${ROUTE_HEIGHT}`}
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

function ActivityCard({
  activity,
  pairedBy,
}: {
  activity: CalendarActivity;
  pairedBy: "athlete" | "auto" | null;
}) {
  const sport = sportName(activity.sport, activity.indoor);
  const distance = activity.meters ? formatDistance(activity.meters) : null;
  const analysing = activity.load === null && activity.analysisDue;
  return (
    <li className="done-card" data-state={pairedBy ? "done" : "unplanned"}>
      <Link to="/activities/$id" params={{ id: activity.id }} className="done-link">
        <span className="plan-title">
          <span className="plan-sport" title={sport.label}>
            <SportIcon family={sport.family} />
          </span>
          <span className="plan-name">{activityTitle(activity)}</span>
          <span className="done-mark" title="Done">
            <CalendarIcon name="done" size={12} />
          </span>
        </span>
        <span className="plan-meta">
          {activity.seconds !== null && <span>{formatHours(activity.seconds)}</span>}
          {distance && (
            <span className="done-distance">
              {distance.value}
              <span className="unit"> {distance.unit}</span>
            </span>
          )}
          {activity.load !== null ? (
            <span>
              {formatLoad(activity.load)}
              <span className="unit"> load</span>
            </span>
          ) : (
            analysing && <span className="muted">Analysing</span>
          )}
        </span>
        {activity.route && <RouteDrawing route={activity.route} />}
        <span className="done-pairing">
          {pairedBy === null ? "Unplanned" : pairedBy === "athlete" ? "Paired by you" : "Matched"}
        </span>
      </Link>
    </li>
  );
}

function figureOf(kind: keyof CalendarTotals, value: number) {
  if (kind === "seconds") return formatHours(value);
  if (kind === "meters") {
    const distance = formatDistance(value);
    return `${distance.value} ${distance.unit}`;
  }
  return formatLoad(value);
}

const meterNames: Record<keyof CalendarTotals, string> = {
  seconds: "Time",
  meters: "Distance",
  load: "Load",
};

function WeekTotals({
  start,
  today,
  totals,
  canCopy,
  onCopy,
}: {
  start: string;
  today: string;
  totals: ReturnType<typeof totalsOf>;
  canCopy: boolean;
  onCopy: () => void;
}) {
  const kinds = ["seconds", "meters", "load"] as const;
  const nothing = kinds.every((kind) => totals.planned[kind] === 0 && totals.completed[kind] === 0);
  return (
    <div className="week-totals">
      <p className="week-name">{weekLabel(start, today)}</p>
      {nothing ? (
        <p className="week-empty muted">Nothing planned or done</p>
      ) : (
        <dl className="meters">
          {kinds.map((kind) => {
            const meter = meterOf(totals.completed[kind], totals.planned[kind]);
            return (
              <div key={kind} className="meter-row">
                <dt>{meterNames[kind]}</dt>
                <dd>
                  <span className="meter" aria-hidden="true">
                    <span className="meter-fill" style={{ width: `${meter.fill * 100}%` }} />
                    {meter.mark !== null && (
                      <span className="meter-mark" style={{ left: `${meter.mark * 100}%` }} />
                    )}
                  </span>
                  <span className="meter-figure">
                    {meter.done === 0 && meter.planned === 0 ? "-" : figureOf(kind, meter.done)}
                    {meter.planned > 0 && (
                      <span className="muted"> of {figureOf(kind, meter.planned)}</span>
                    )}
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      <Menu
        label={`Change the week of ${dayInShort(start)}`}
        className="week-menu"
        summary={<CalendarIcon name="more" />}
      >
        {(close) => (
          <button
            type="button"
            className="quiet menu-item"
            disabled={!canCopy}
            onClick={() => {
              close();
              onCopy();
            }}
          >
            {canCopy ? "Copy this week to another" : "Nothing planned to copy"}
          </button>
        )}
      </Menu>
    </div>
  );
}
