import type {
  CalendarActivity,
  CalendarDay,
  CalendarTotals,
  PlannedContent,
  PlannedWorkout,
} from "@trainstack/contract";

import type { ApiClient } from "./client.ts";
import { mondayOf, weekLabel } from "./dates.ts";
import { daysBetween, shiftDay } from "./training.ts";

export type CalendarRange = Awaited<ReturnType<ApiClient["calendar"]["range"]>>;
export type CalendarView = "month" | "week";

export const calendarViews = ["month", "week"] as const;

export const calendarKey = ["calendar"] as const;
export const rangeKey = (from: string, through: string) => [...calendarKey, from, through] as const;

export interface Period {
  readonly view: CalendarView;
  readonly at: string;
  readonly from: string;
  readonly through: string;
  readonly label: string;
}

const monthFormat = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const dayPattern = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const isDay = (text: string) =>
  dayPattern.test(text) && new Date(`${text}T00:00:00Z`).toISOString().startsWith(text);

const monthOf = (day: string) => day.slice(0, 7);

const lastDayOfMonth = (month: string) => {
  const [year, number] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
};

export function anchorOf(view: CalendarView, at: string | undefined, today: string) {
  if (view === "month") {
    if (at !== undefined && monthPattern.test(at)) return at;
    if (at !== undefined && isDay(at)) return monthOf(at);
    return monthOf(today);
  }
  if (at !== undefined && isDay(at)) return mondayOf(at);
  if (at !== undefined && monthPattern.test(at)) return mondayOf(`${at}-01`);
  return mondayOf(today);
}

export function periodOf(view: CalendarView, at: string | undefined, today: string): Period {
  const anchor = anchorOf(view, at, today);
  if (view === "week") {
    return {
      view,
      at: anchor,
      from: anchor,
      through: shiftDay(anchor, 6),
      label: weekLabel(anchor, today),
    };
  }
  const first = `${anchor}-01`;
  return {
    view,
    at: anchor,
    from: mondayOf(first),
    through: shiftDay(mondayOf(lastDayOfMonth(anchor)), 6),
    label: monthFormat.format(new Date(`${first}T00:00:00Z`)),
  };
}

export function shiftedAnchor(period: Period, by: number) {
  if (period.view === "week") return shiftDay(period.at, by * 7);
  const [year, month] = period.at.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1 + by, 1)).toISOString().slice(0, 7);
}

export const anchorContaining = (view: CalendarView, day: string) =>
  view === "week" ? mondayOf(day) : monthOf(day);

export const isInMonth = (period: Period, day: string) =>
  period.view === "week" || monthOf(day) === period.at;

export function daysOf(from: string, through: string) {
  const count = daysBetween(from, through) + 1;
  return Array.from({ length: count }, (_, index) => shiftDay(from, index));
}

export const plannedName = (content: PlannedContent) =>
  content.kind === "workout"
    ? content.workout.name
    : content.kind === "note"
      ? content.title
      : "Rest day";

export function stateOn(
  item: Pick<PlannedWorkout, "content" | "skipped" | "pairing">,
  day: string,
  today: string,
): PlannedWorkout["state"] {
  if (item.pairing) return "completed";
  if (item.skipped) return "skipped";
  if (item.content.kind === "workout" && day < today) return "missed";
  return "planned";
}

export function positionAt(positions: readonly number[], index: number) {
  if (positions.length === 0) return 0;
  const at = Math.max(0, Math.min(index, positions.length));
  if (at === 0) return positions[0]! - 1;
  if (at === positions.length) return positions.at(-1)! + 1;
  return (positions[at - 1]! + positions[at]!) / 2;
}

export const endOfDay = (planned: readonly Pick<PlannedWorkout, "position">[]) =>
  planned.length === 0 ? 0 : Math.max(...planned.map((item) => item.position)) + 1;

export interface Placement {
  readonly day: string;
  readonly position: number;
}

export function placementFor(
  range: CalendarRange,
  id: string,
  day: string,
  index: number,
): Placement | null {
  const target = range.days.find((entry) => entry.day === day);
  if (!target) return null;
  const rest = target.planned.filter((item) => item.id !== id);
  const current = target.planned.findIndex((item) => item.id === id);
  if (current !== -1 && Math.min(index, rest.length) === current) return null;
  return {
    day,
    position: positionAt(
      rest.map((item) => item.position),
      index,
    ),
  };
}

export interface Spot {
  readonly day: string;
  readonly index: number;
}

export function spotOf(range: CalendarRange, id: string): Spot | null {
  for (const entry of range.days) {
    const index = entry.planned.findIndex((item) => item.id === id);
    if (index !== -1) return { day: entry.day, index };
  }
  return null;
}

export type Nudge =
  | "previous-day"
  | "next-day"
  | "earlier"
  | "later"
  | "previous-week"
  | "next-week";

export function nudged(range: CalendarRange, id: string, spot: Spot, nudge: Nudge): Spot {
  const days = range.days.map((entry) => entry.day);
  const at = days.indexOf(spot.day);
  const sizeOf = (day: string) =>
    range.days.find((entry) => entry.day === day)!.planned.filter((item) => item.id !== id).length;
  const toDay = (offset: number) => {
    const day = days[Math.max(0, Math.min(days.length - 1, at + offset))]!;
    return { day, index: Math.min(spot.index, sizeOf(day)) };
  };
  switch (nudge) {
    case "previous-day":
      return toDay(-1);
    case "next-day":
      return toDay(1);
    case "previous-week":
      return toDay(-7);
    case "next-week":
      return toDay(7);
    case "earlier":
      return { day: spot.day, index: Math.max(0, spot.index - 1) };
    case "later":
      return { day: spot.day, index: Math.min(sizeOf(spot.day), spot.index + 1) };
  }
}

const zero: CalendarTotals = { seconds: 0, meters: 0, load: 0 };

function plannedTotals(item: PlannedWorkout, sign: 1 | -1): CalendarTotals {
  return {
    seconds: sign * (item.planned?.seconds ?? 0),
    meters: sign * (item.planned?.meters ?? 0),
    load: sign * (item.planned?.load ?? 0),
  };
}

const added = (a: CalendarTotals, b: CalendarTotals): CalendarTotals => ({
  seconds: a.seconds + b.seconds,
  meters: a.meters + b.meters,
  load: a.load + b.load,
});

const byPlace = (a: PlannedWorkout, b: PlannedWorkout) =>
  a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function withPlannedTotals(range: CalendarRange, day: string, change: CalendarTotals) {
  const week = mondayOf(day);
  return {
    ...range,
    days: range.days.map((entry) =>
      entry.day === day
        ? { ...entry, totals: { ...entry.totals, planned: added(entry.totals.planned, change) } }
        : entry,
    ),
    weeks: range.weeks.map((entry) =>
      entry.start === week
        ? { ...entry, totals: { ...entry.totals, planned: added(entry.totals.planned, change) } }
        : entry,
    ),
  };
}

export function findPlanned(range: CalendarRange, id: string) {
  for (const entry of range.days) {
    const item = entry.planned.find((held) => held.id === id);
    if (item) return item;
  }
  return null;
}

export function withoutPlanned(range: CalendarRange, id: string): CalendarRange {
  const held = findPlanned(range, id);
  if (!held) return range;
  const removed = {
    ...range,
    days: range.days.map((entry) =>
      entry.day === held.day
        ? { ...entry, planned: entry.planned.filter((item) => item.id !== id) }
        : entry,
    ),
  };
  return withPlannedTotals(removed, held.day, plannedTotals(held, -1));
}

export function withPlanned(range: CalendarRange, item: PlannedWorkout): CalendarRange {
  const cleared = withoutPlanned(range, item.id);
  if (!cleared.days.some((entry) => entry.day === item.day)) return cleared;
  const placed = {
    ...cleared,
    days: cleared.days.map((entry) =>
      entry.day === item.day
        ? { ...entry, planned: [...entry.planned, item].toSorted(byPlace) }
        : entry,
    ),
  };
  return withPlannedTotals(placed, item.day, plannedTotals(item, 1));
}

export function moved(item: PlannedWorkout, placement: Placement, today: string): PlannedWorkout {
  const next = { ...item, ...placement, pairing: placement.day === item.day ? item.pairing : null };
  return { ...next, state: stateOn(next, placement.day, today) };
}

export function skippedAs(
  item: PlannedWorkout,
  skipped: PlannedWorkout["skipped"],
  today: string,
): PlannedWorkout {
  const next = { ...item, skipped };
  return { ...next, state: stateOn(next, item.day, today) };
}

export function draftPlanned(
  input: { id: string; day: string; position: number; content: PlannedContent },
  today: string,
  now: Date,
): PlannedWorkout {
  const item = {
    ...input,
    planId: null,
    planned: null,
    skipped: null,
    pairing: null,
    compliance: null,
    createdAt: now,
    updatedAt: now,
    state: "planned" as const,
  };
  return { ...item, state: stateOn(item, input.day, today) };
}

export interface WeekCopy {
  readonly id: string;
  readonly day: string;
  readonly position: number;
  readonly content: PlannedContent;
}

export function weekCopies(
  source: readonly CalendarDay[],
  target: readonly CalendarDay[],
  newId: () => string,
): WeekCopy[] {
  const offset = daysBetween(source[0]!.day, target[0]!.day);
  return source.flatMap((entry) => {
    const day = shiftDay(entry.day, offset);
    const start = endOfDay(target.find((held) => held.day === day)?.planned ?? []);
    return entry.planned.map((item, index) => ({
      id: newId(),
      day,
      position: start + index,
      content: structuredClone(item.content),
    }));
  });
}

export const totalsOf = (range: CalendarRange, monday: string) =>
  range.weeks.find((week) => week.start === monday)?.totals ?? { planned: zero, completed: zero };

export function weeksOf(range: CalendarRange) {
  const weeks: { start: string; days: CalendarDay[] }[] = [];
  for (const entry of range.days) {
    const start = mondayOf(entry.day);
    const last = weeks.at(-1);
    if (last?.start === start) last.days.push(entry);
    else weeks.push({ start, days: [entry] });
  }
  return weeks;
}

export interface Meter {
  readonly done: number;
  readonly planned: number;
  readonly fill: number;
  readonly mark: number | null;
}

export function meterOf(done: number, planned: number): Meter {
  const scale = Math.max(done, planned);
  if (scale <= 0) return { done, planned, fill: 0, mark: null };
  return {
    done,
    planned,
    fill: done / scale,
    mark: planned > 0 && done > planned ? planned / scale : null,
  };
}

const longDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const shortDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const weekdayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

export const dayInFull = (day: string) => longDay.format(asDate(day));
export const dayInShort = (day: string) => shortDay.format(asDate(day));
export const weekdayOf = (day: string) => weekdayFormat.format(asDate(day));
export const monthNameOf = (day: string) => monthShort.format(asDate(day));
export const weekdayNames = daysOf("2024-01-01", "2024-01-07").map(weekdayOf);

export interface PlannedEntry {
  readonly item: PlannedWorkout;
  readonly done: CalendarActivity | null;
}

export function pairsOf(day: Pick<CalendarDay, "planned" | "activities">) {
  const activities = new Map(day.activities.map((activity) => [activity.id, activity]));
  const claimed = new Map<string, string>();
  const byAthleteFirst = day.planned.toSorted(
    (a, b) => Number(b.pairing?.by === "athlete") - Number(a.pairing?.by === "athlete"),
  );
  for (const item of byAthleteFirst) {
    const activityId = item.pairing?.activityId;
    if (activityId && activities.has(activityId) && !claimed.has(activityId)) {
      claimed.set(activityId, item.id);
    }
  }
  const planned: PlannedEntry[] = day.planned.map((item) => {
    const activityId = item.pairing?.activityId;
    const done =
      activityId && claimed.get(activityId) === item.id ? activities.get(activityId)! : null;
    return { item, done };
  });
  const unplanned = day.activities.filter((activity) => !claimed.has(activity.id));
  return { planned, unplanned };
}

export function pairedAs(
  item: PlannedWorkout,
  activityId: string | null,
  today: string,
): PlannedWorkout {
  const next = {
    ...item,
    pairing: activityId ? { activityId, by: "athlete" as const } : null,
    compliance: null,
  };
  return { ...next, state: stateOn(next, item.day, today) };
}
