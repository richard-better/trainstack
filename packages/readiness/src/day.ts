const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const millisecondsPerDay = 86_400_000;

export function dayNumber(day: string): number {
  const time = dayPattern.test(day) ? Date.parse(`${day}T00:00:00Z`) : NaN;
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day) {
    throw new RangeError(`Not a calendar day: ${day}`);
  }
  return time / millisecondsPerDay;
}

export const dayOf = (number: number) =>
  new Date(number * millisecondsPerDay).toISOString().slice(0, 10);

export const shiftDay = (day: string, days: number) => dayOf(dayNumber(day) + days);

export const daysBetween = (from: string, through: string) => dayNumber(through) - dayNumber(from);
