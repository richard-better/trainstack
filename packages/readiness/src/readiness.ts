import {
  baselineCheckIns,
  checkInBaseline,
  type CheckInReason,
  checkInReasons,
} from "./check-in.ts";
import { dayNumber, dayOf, shiftDay } from "./day.ts";
import { type HealthReason, healthReasons } from "./health.ts";
import {
  type ReadinessCheckIn,
  type ReadinessInput,
  type ReadinessPlanned,
  unmeasured,
  type Unmeasured,
} from "./inputs.ts";
import { type Intensity, intensityOf } from "./planned.ts";
import {
  type LoadSeries,
  loadSeries,
  type TrainingGap,
  type TrainingReason,
  trainingState,
} from "./training.ts";

export const levels = ["ready", "fair", "low", "poor"] as const;

export type Level = (typeof levels)[number];

export const levelFromWeight: readonly { readonly from: number; readonly level: Level }[] = [
  { from: 6, level: "poor" },
  { from: 4, level: "low" },
  { from: 2, level: "fair" },
  { from: 0, level: "ready" },
];

export type Reason<Area extends string = string> =
  | HealthReason<Area>
  | CheckInReason
  | TrainingReason;

export type Gap =
  | { readonly kind: "no_check_in" }
  | { readonly kind: "short_baseline"; readonly checkIns: number }
  | TrainingGap;

export type Confidence = "high" | "medium" | "low";

export type Action = "as_planned" | "ease" | "swap_easy" | "rest";

export interface Suggestion {
  readonly plannedId: string;
  readonly intensity: Intensity;
  readonly action: Action;
  readonly plannedLoad: number | null;
  readonly plannedSeconds: number | null;
}

export interface Basis {
  readonly checkIn: boolean;
  readonly baselineCheckIns: number;
  readonly trainingDays: number;
  readonly unmeasured: Unmeasured[];
}

export interface DayReadiness<Area extends string = string> {
  readonly day: string;
  readonly level: Level | null;
  readonly confidence: Confidence;
  readonly reasons: Reason<Area>[];
  readonly gaps: Gap[];
  readonly basis: Basis;
  readonly suggestions: Suggestion[];
}

const actions: Record<Level, Record<Exclude<Intensity, "unknown">, Action>> = {
  ready: { easy: "as_planned", moderate: "as_planned", hard: "as_planned" },
  fair: { easy: "as_planned", moderate: "as_planned", hard: "ease" },
  low: { easy: "as_planned", moderate: "ease", hard: "swap_easy" },
  poor: { easy: "rest", moderate: "rest", hard: "rest" },
};

export const actionFor = (level: Level, intensity: Intensity): Action =>
  actions[level][intensity === "unknown" ? "moderate" : intensity];

const worse = (a: Level, b: Level) => (levels.indexOf(a) >= levels.indexOf(b) ? a : b);

export const maxTrainingWeight = 3;

const sumOfWeights = (reasons: readonly { readonly weight: number }[]) =>
  reasons.reduce((sum, reason) => sum + reason.weight, 0);

function levelOf(weight: number, health: readonly HealthReason[]): Level {
  let level = levelFromWeight.find(({ from }) => weight >= from)!.level;
  for (const reason of health) {
    if (reason.kind === "ill") level = worse(level, "poor");
    if (reason.kind === "injured" && reason.training === "none") level = worse(level, "poor");
    if (reason.kind === "injured" && reason.training === "reduced") level = worse(level, "low");
    if (reason.kind === "recently_ill") level = worse(level, "fair");
  }
  return level;
}

const overrides = (health: readonly HealthReason[]) =>
  health.some(
    (reason) => reason.kind === "ill" || (reason.kind === "injured" && reason.training === "none"),
  );

function confidenceOf(gaps: readonly Gap[], health: readonly HealthReason[]): Confidence {
  if (overrides(health)) return "high";
  if (gaps.some((gap) => gap.kind === "no_check_in")) return "low";
  return gaps.length === 0 ? "high" : "medium";
}

const effectOrder = { lowers: 0, raises: 1, steady: 2 } as const;

function ordered<Area extends string>(
  health: readonly HealthReason<Area>[],
  scored: readonly (CheckInReason | TrainingReason)[],
): Reason<Area>[] {
  return [
    ...health,
    ...[...scored].sort(
      (a, b) => b.weight - a.weight || effectOrder[a.effect] - effectOrder[b.effect],
    ),
  ];
}

interface Prepared<Area extends string> {
  readonly checkIns: readonly ReadinessCheckIn<Area>[];
  readonly byDay: ReadonlyMap<string, ReadinessCheckIn<Area>>;
  readonly series: LoadSeries;
  readonly planned: ReadonlyMap<string, readonly ReadinessPlanned[]>;
}

const isAnswered = (checkIn: ReadinessCheckIn<string>) =>
  checkIn.illness !== null ||
  checkIn.injury !== null ||
  Object.values(checkIn.ratings).some((rating) => rating !== null);

function prepare<Area extends string>(
  input: ReadinessInput<Area>,
  through: string,
): Prepared<Area> {
  const checkIns = input.checkIns.filter(isAnswered);
  return {
    checkIns,
    byDay: new Map(checkIns.map((checkIn) => [checkIn.day, checkIn])),
    series: loadSeries(input.stress, shiftDay(through, -1)),
    planned: input.planned,
  };
}

function readinessFrom<Area extends string>(
  prepared: Prepared<Area>,
  day: string,
): DayReadiness<Area> {
  const today = prepared.byDay.get(day) ?? null;
  const training = trainingState(prepared.series, day);
  const health = healthReasons(today, prepared.checkIns, day);
  const checkIn = today ? checkInReasons(today, prepared.checkIns) : [];
  const baseline = baselineCheckIns(
    prepared.checkIns,
    day,
    checkIn.map((reason) => reason.item),
  );
  const gaps: Gap[] = [];
  if (!today) gaps.push({ kind: "no_check_in" });
  else if (baseline < checkInBaseline.minimum)
    gaps.push({ kind: "short_baseline", checkIns: baseline });
  if (training.gap) gaps.push(training.gap);
  const reasons = ordered(health, [...checkIn, ...training.reasons]);
  const weight =
    sumOfWeights(checkIn) + Math.min(maxTrainingWeight, sumOfWeights(training.reasons));
  const hasBasis = today !== null || training.gap === null || health.length > 0;
  const level = hasBasis ? levelOf(weight, health) : null;
  const suggestions: Suggestion[] =
    level === null
      ? []
      : (prepared.planned.get(day) ?? [])
          .filter((planned) => planned.kind === "workout" && planned.state === "planned")
          .map((planned) => {
            const intensity = intensityOf(planned, training.fitness);
            return {
              plannedId: planned.id,
              intensity,
              action: overrides(health) ? "rest" : actionFor(level, intensity),
              plannedLoad: planned.load,
              plannedSeconds: planned.seconds,
            };
          });
  return {
    day,
    level,
    confidence: level === null ? "low" : confidenceOf(gaps, health),
    reasons,
    gaps,
    basis: {
      checkIn: today !== null,
      baselineCheckIns: baseline,
      trainingDays: training.historyDays,
      unmeasured: [...unmeasured],
    },
    suggestions,
  };
}

export function readinessOn<Area extends string>(
  input: ReadinessInput<Area>,
  day: string,
): DayReadiness<Area> {
  return readinessFrom(prepare(input, day), day);
}

export function readinessRange<Area extends string>(
  input: ReadinessInput<Area>,
  from: string,
  through: string,
): DayReadiness<Area>[] {
  const prepared = prepare(input, through);
  const days: DayReadiness<Area>[] = [];
  for (let number = dayNumber(from); number <= dayNumber(through); number++) {
    days.push(readinessFrom(prepared, dayOf(number)));
  }
  return days;
}
