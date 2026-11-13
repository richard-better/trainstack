const month = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
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

export const monthOf = (date: Date) => month.format(date);
export const activityDate = (date: Date) => day.format(date);
export const activityDateInFull = (date: Date) => full.format(date);

export interface Month<Item> {
  readonly id: string;
  readonly label: string;
  readonly items: Item[];
}

export function byMonth<Item>(items: readonly Item[], dateOf: (item: Item) => Date) {
  const months: Month<Item>[] = [];
  for (const item of items) {
    const date = dateOf(item);
    const id = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const last = months.at(-1);
    if (last?.id === id) last.items.push(item);
    else months.push({ id, label: monthOf(date), items: [item] });
  }
  return months;
}
