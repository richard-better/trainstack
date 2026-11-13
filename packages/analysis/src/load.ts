export const fitnessDays = 42;
export const fatigueDays = 7;
export const maxTrainingLoadDays = 100 * 366;

export interface DailyLoad {
  readonly day: string;
  readonly stress: number;
  readonly fitness: number;
  readonly fatigue: number;
  readonly form: number;
}

export interface DatedStress {
  readonly day: string;
  readonly stress: number | null;
}

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const millisecondsPerDay = 24 * 60 * 60 * 1000;

function dayNumber(day: string): number {
  const time = dayPattern.test(day) ? Date.parse(`${day}T00:00:00Z`) : NaN;
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day) {
    throw new RangeError(`Not a calendar day: ${day}`);
  }
  return time / millisecondsPerDay;
}

const dayOf = (number: number) => new Date(number * millisecondsPerDay).toISOString().slice(0, 10);

export function stressByDay(activities: readonly DatedStress[]): Map<string, number> {
  const days = new Map<string, number>();
  for (const { day, stress } of activities) {
    if (stress === null || !Number.isFinite(stress)) continue;
    dayNumber(day);
    days.set(day, (days.get(day) ?? 0) + stress);
  }
  return days;
}

export function trainingLoad(
  stress: ReadonlyMap<string, number>,
  from: string,
  through: string,
): DailyLoad[] {
  const first = dayNumber(from);
  const last = dayNumber(through);
  if (last - first + 1 > maxTrainingLoadDays) {
    throw new RangeError(`More than ${maxTrainingLoadDays} days`);
  }
  let fitness = 0;
  let fatigue = 0;
  const days: DailyLoad[] = [];
  for (let number = first; number <= last; number++) {
    const day = dayOf(number);
    const today = stress.get(day) ?? 0;
    fitness += (today - fitness) / fitnessDays;
    fatigue += (today - fatigue) / fatigueDays;
    days.push({ day, stress: today, fitness, fatigue, form: fitness - fatigue });
  }
  return days;
}
