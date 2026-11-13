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
