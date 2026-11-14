const day = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const full = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const activityDate = (date: Date) => day.format(date);
export const activityDateInFull = (date: Date) => full.format(date);

const DAY_MS = 86_400_000;
const dayAndMonth = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const dayMonthYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const utcDay = (day: string) => new Date(`${day}T00:00:00Z`);

export function mondayOf(day: string) {
  const date = utcDay(day);
  const back = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}

export function weekLabel(monday: string, today?: string) {
  const start = utcDay(monday);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  if (today !== undefined && mondayOf(today) === monday) return "This week";
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
  const showYear =
    today === undefined || !sameYear || end.getUTCFullYear() !== utcDay(today).getUTCFullYear();
  const through = (showYear ? dayMonthYear : dayAndMonth).format(end);
  if (sameMonth) return `${start.getUTCDate()}-${through}`;
  const from = sameYear ? dayAndMonth.format(start) : dayMonthYear.format(start);
  return `${from} - ${through}`;
}

export interface Week<Item> {
  readonly id: string;
  readonly items: Item[];
}

export function byWeek<Item>(items: readonly Item[], dayOf: (item: Item) => string) {
  const weeks = new Map<string, Item[]>();
  for (const item of items) {
    const id = mondayOf(dayOf(item));
    const week = weeks.get(id);
    if (week) week.push(item);
    else weeks.set(id, [item]);
  }
  return [...weeks].map(([id, weekItems]): Week<Item> => ({ id, items: weekItems }));
}
