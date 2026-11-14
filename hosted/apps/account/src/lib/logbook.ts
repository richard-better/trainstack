import type { GradeValue, LoggedSummary, StoredSession } from "@trainstack/contract";
import {
  type BoulderingDetail,
  type Circuit,
  type CustomExercise,
  type Exercise,
  exerciseCatalogue,
  findExercise,
  fontGrades,
  type Grade,
  inUnit,
  type LoggedExercise,
  type LoggedSession,
  loggedSessionSchema,
  type MassUnit,
  type Problem,
  type ProblemOutcome,
  type SetKind,
  type SetLoad,
  type StrengthSet,
  vGrades,
} from "@trainstack/logbook";

export type LoadKind = SetLoad["kind"];

export type SetDraft = {
  key: string;
  kind: SetKind;
  reps: string;
  seconds: string;
  loadKind: LoadKind;
  mass: string;
  unit: MassUnit;
  rpe: string;
  repsInReserve: string;
  tempo: string;
  rest: string;
};

export type ExerciseDraft = {
  key: string;
  exerciseId: string;
  group: number | null;
  notes: string;
  sets: SetDraft[];
};

export type Timing = {
  day: string;
  time: string;
  minutes: string;
  name: string;
  notes: string;
  rpe: number | null;
};

export type StrengthDraft = Timing & {
  sport: "strength";
  unit: MassUnit;
  exercises: ExerciseDraft[];
};

export type ProblemDraft = Problem & { key: string };

export type BoulderingDraft = Timing & {
  sport: "bouldering";
  venueKind: "gym" | "crag";
  venueName: string;
  circuit: Circuit | null;
  problems: ProblemDraft[];
};

export type Draft = StrengthDraft | BoulderingDraft;

export const newKey = () => crypto.randomUUID();

const pad = (value: number) => String(value).padStart(2, "0");

export function timingFrom(startedAt: Date, durationSeconds: number | null) {
  return {
    day: `${startedAt.getFullYear()}-${pad(startedAt.getMonth() + 1)}-${pad(startedAt.getDate())}`,
    time: `${pad(startedAt.getHours())}:${pad(startedAt.getMinutes())}`,
    minutes: durationSeconds === null ? "" : String(Math.round(durationSeconds / 60)),
  };
}

export function startOf({ day, time }: Pick<Timing, "day" | "time">) {
  const [year, month, date] = day.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year!, month! - 1, date!, hours!, minutes!);
}

export const MINIMUM_MINUTES = 1;

export function durationOf(timing: Pick<Timing, "day" | "time" | "minutes">, now = new Date()) {
  const typed = Number(timing.minutes);
  if (timing.minutes.trim() !== "") return Number.isFinite(typed) ? Math.round(typed * 60) : NaN;
  const sinceStart = Math.round((now.getTime() - startOf(timing).getTime()) / 60_000);
  return Math.max(MINIMUM_MINUTES, sinceStart) * 60;
}

export function blankTiming(now = new Date()): Timing {
  return { ...timingFrom(now, null), name: "", notes: "", rpe: null };
}

export const blankStrength = (unit: MassUnit, now = new Date()): StrengthDraft => ({
  sport: "strength",
  ...blankTiming(now),
  unit,
  exercises: [],
});

export const blankBouldering = (now = new Date()): BoulderingDraft => ({
  sport: "bouldering",
  ...blankTiming(now),
  venueKind: "gym",
  venueName: "",
  circuit: null,
  problems: [],
});

const text = (value: number | null) => (value === null ? "" : String(round(value)));

const round = (value: number) => Math.round(value * 100) / 100;

export function setDraftOf(set: StrengthSet, unit: MassUnit): SetDraft {
  const mass =
    set.load.kind === "weight"
      ? set.load.weight
      : set.load.kind === "weighted"
        ? set.load.added
        : set.load.kind === "assisted"
          ? set.load.assistance
          : null;
  return {
    key: newKey(),
    kind: set.kind,
    reps: text(set.reps),
    seconds: text(set.seconds),
    loadKind: set.load.kind,
    mass: mass ? text(mass.value) : "",
    unit: mass?.unit ?? unit,
    rpe: text(set.rpe),
    repsInReserve: text(set.repsInReserve),
    tempo: set.tempo ?? "",
    rest: text(set.restSeconds),
  };
}

export function exerciseDraftOf(entry: LoggedExercise, unit: MassUnit): ExerciseDraft {
  return {
    key: newKey(),
    exerciseId: entry.exerciseId,
    group: entry.group,
    notes: entry.notes ?? "",
    sets: entry.sets.map((set) => setDraftOf(set, unit)),
  };
}

export function blankSet(
  exercise: Exercise | CustomExercise | undefined,
  unit: MassUnit,
): SetDraft {
  return {
    key: newKey(),
    kind: "working",
    reps: "",
    seconds: "",
    loadKind: exercise?.bodyweight ? "bodyweight" : "weight",
    mass: "",
    unit,
    rpe: "",
    repsInReserve: "",
    tempo: "",
    rest: "",
  };
}

export const repeatedSet = (set: SetDraft): SetDraft => ({ ...set, key: newKey() });

export function nextSet(sets: readonly SetDraft[], fallback: SetDraft): SetDraft {
  const last = sets.at(-1);
  if (!last) return fallback;
  return { ...repeatedSet(last), kind: last.kind === "warm_up" ? "working" : last.kind };
}

export function exerciseFromHistory(
  exerciseId: string,
  latest: StoredSession | null | undefined,
  unit: MassUnit,
  custom: readonly CustomExercise[],
): ExerciseDraft {
  const previous =
    latest?.session.detail.sport === "strength"
      ? latest.session.detail.exercises.find((entry) => entry.exerciseId === exerciseId)
      : undefined;
  if (previous) return { ...exerciseDraftOf(previous, unit), group: null, notes: "" };
  return {
    key: newKey(),
    exerciseId,
    group: null,
    notes: "",
    sets: [blankSet(findExercise(exerciseId, custom), unit)],
  };
}

export function repeatStrength(draft: StrengthDraft, latest: StoredSession): StrengthDraft {
  if (latest.session.detail.sport !== "strength") return draft;
  return {
    ...draft,
    exercises: latest.session.detail.exercises.map((entry) => exerciseDraftOf(entry, draft.unit)),
  };
}

export function repeatBouldering(draft: BoulderingDraft, latest: StoredSession): BoulderingDraft {
  if (latest.session.detail.sport !== "bouldering") return draft;
  const { venue, circuit } = latest.session.detail;
  return { ...draft, venueKind: venue.kind, venueName: venue.name ?? "", circuit };
}

export function draftOf(stored: StoredSession, unit: MassUnit): Draft {
  const { session } = stored;
  const timing = {
    ...timingFrom(session.startedAt, session.durationSeconds),
    name: session.name ?? "",
    notes: session.notes ?? "",
    rpe: session.rpe,
  };
  if (session.detail.sport === "strength") {
    const sessionUnit = stored.summary.sport === "strength" ? stored.summary.unit : unit;
    return {
      sport: "strength",
      ...timing,
      unit: sessionUnit,
      exercises: session.detail.exercises.map((entry) => exerciseDraftOf(entry, sessionUnit)),
    };
  }
  return {
    sport: "bouldering",
    ...timing,
    venueKind: session.detail.venue.kind,
    venueName: session.detail.venue.name ?? "",
    circuit: session.detail.circuit,
    problems: session.detail.problems.map((problem) => ({ ...problem, key: newKey() })),
  };
}

function withoutKey({ key, ...problem }: ProblemDraft): Problem {
  void key;
  return problem;
}

const optionalNumber = (value: string) => (value.trim() === "" ? null : Number(value));

const massOf = (set: SetDraft) => ({ value: Number(set.mass || 0), unit: set.unit });

function loadOf(set: SetDraft): SetLoad {
  switch (set.loadKind) {
    case "weight":
      return { kind: "weight", weight: massOf(set) };
    case "bodyweight":
      return { kind: "bodyweight" };
    case "weighted":
      return { kind: "weighted", added: massOf(set) };
    case "assisted":
      return { kind: "assisted", assistance: massOf(set) };
  }
}

const strengthSetOf = (set: SetDraft): StrengthSet => ({
  kind: set.kind,
  reps: optionalNumber(set.reps),
  seconds: optionalNumber(set.seconds),
  load: loadOf(set),
  rpe: optionalNumber(set.rpe),
  repsInReserve: optionalNumber(set.repsInReserve),
  tempo: set.tempo.trim() === "" ? null : set.tempo.trim().toUpperCase(),
  restSeconds: optionalNumber(set.rest),
});

const orNull = (value: string) => (value.trim() === "" ? null : value.trim());

const isBlankSet = (set: SetDraft) => set.reps.trim() === "" && set.seconds.trim() === "";

export function sessionOf(draft: Draft, now = new Date()): LoggedSession {
  const timing = {
    startedAt: startOf(draft),
    durationSeconds: durationOf(draft, now),
    name: orNull(draft.name),
    notes: orNull(draft.notes),
    rpe: draft.rpe,
  };
  if (draft.sport === "strength") {
    return {
      ...timing,
      detail: {
        sport: "strength",
        exercises: draft.exercises
          .map((entry) => ({
            exerciseId: entry.exerciseId,
            group: entry.group,
            notes: orNull(entry.notes),
            sets: entry.sets.filter((set) => !isBlankSet(set)).map(strengthSetOf),
          }))
          .filter((entry) => entry.sets.length > 0),
      },
    };
  }
  const detail: BoulderingDetail = {
    sport: "bouldering",
    venue: { kind: draft.venueKind, name: orNull(draft.venueName) },
    circuit: draft.circuit,
    problems: draft.problems.map(withoutKey),
  };
  return { ...timing, detail };
}

export function problemsWith(draft: Draft, now = new Date()) {
  const result = loggedSessionSchema.safeParse(sessionOf(draft, now));
  if (result.success) return { session: result.data, problem: null };
  const issue = result.error.issues[0]!;
  return { session: null, problem: describeIssue(draft, issue.path, issue.message) };
}

function describeIssue(draft: Draft, path: readonly PropertyKey[], message: string) {
  if (path[0] === "durationSeconds") return "The session lasts from 1 minute to 12 hours.";
  if (path[0] === "rpe") return "Rate the session from 0 to 10.";
  if (draft.sport === "strength" && path[1] === "exercises" && typeof path[2] === "number") {
    const entry = draft.exercises.filter((exercise) =>
      exercise.sets.some((set) => !isBlankSet(set)),
    )[path[2]];
    const name = entry ? exerciseName(entry.exerciseId, []) : "An exercise";
    const set = typeof path[4] === "number" ? ` set ${path[4] + 1}` : "";
    return `${name}${set}: ${message.charAt(0).toLowerCase()}${message.slice(1)}.`;
  }
  if (draft.sport === "bouldering" && path[1] === "problems" && typeof path[2] === "number") {
    return `Problem ${path[2] + 1}: ${message.charAt(0).toLowerCase()}${message.slice(1)}.`;
  }
  return `${message}.`;
}

export function exerciseName(id: string, custom: readonly CustomExercise[]) {
  return findExercise(id, custom)?.name ?? "Exercise";
}

export function exerciseChoices(
  query: string,
  custom: readonly CustomExercise[],
  used: readonly { exerciseId: string }[],
) {
  const all: (Exercise | CustomExercise)[] = [...custom, ...exerciseCatalogue];
  const rank = new Map(used.map(({ exerciseId }, index) => [exerciseId, index]));
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return all
    .filter((exercise) => words.every((word) => exercise.name.toLowerCase().includes(word)))
    .sort(
      (a, b) =>
        (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.name.localeCompare(b.name),
    );
}

export function formatMass(kilograms: number, unit: MassUnit) {
  const value = inUnit(kilograms, unit);
  return `${value.toLocaleString("en-GB", { maximumFractionDigits: 1 })} ${unit}`;
}

export function formatVolume(kilograms: number, unit: MassUnit) {
  return `${Math.round(inUnit(kilograms, unit)).toLocaleString("en-GB")} ${unit}`;
}

export function setSummary(set: StrengthSet) {
  const load = set.load;
  const mass = (value: { value: number; unit: MassUnit }) =>
    `${value.value.toLocaleString("en-GB")} ${value.unit}`;
  const weight =
    load.kind === "weight"
      ? mass(load.weight)
      : load.kind === "bodyweight"
        ? "Bodyweight"
        : load.kind === "weighted"
          ? `BW + ${mass(load.added)}`
          : `BW − ${mass(load.assistance)}`;
  const amount = set.reps !== null ? String(set.reps) : `${set.seconds} s`;
  return { weight, amount };
}

export const setKindLabels: Record<SetKind, string> = {
  warm_up: "Warm-up",
  working: "Working",
  drop: "Drop",
  failure: "To failure",
};

export const setKindMarks: Record<SetKind, string> = {
  warm_up: "W",
  working: "",
  drop: "D",
  failure: "F",
};

export const loadKindLabels: Record<LoadKind, string> = {
  weight: "Weight",
  bodyweight: "Bodyweight",
  weighted: "BW + added",
  assisted: "BW − assist",
};

export const outcomeLabels: Record<ProblemOutcome, string> = {
  flash: "Flash",
  send: "Send",
  repeat: "Repeat",
  project: "Project",
};

export const recordLabels = {
  estimated_one_rep_max: "best estimated 1RM",
  heaviest: "heaviest",
  volume: "most volume",
  most_reps: "most reps",
  longest: "longest hold",
} as const;

export type GradeChoice = { label: string; grade: Grade };

export function gradeChoices(scale: "font" | "v" | "circuit", circuit: Circuit | null) {
  if (scale === "font")
    return fontGrades.map((grade) => ({ label: grade, grade: { scale, grade } }));
  if (scale === "v") return vGrades.map((grade) => ({ label: grade, grade: { scale, grade } }));
  return (circuit?.colours ?? []).map(({ name }) => ({
    label: name,
    grade: { scale: "circuit", colour: name } as Grade,
  }));
}

export const gradeText = (grade: Grade) => (grade.scale === "circuit" ? grade.colour : grade.grade);

export function gradeValueText(value: GradeValue | null) {
  if (!value) return null;
  if (value.grade.scale !== "circuit") return gradeText(value.grade);
  return value.font ? `${value.grade.colour} (${value.font})` : value.grade.colour;
}

export const presetColours = [
  "White",
  "Yellow",
  "Orange",
  "Green",
  "Blue",
  "Red",
  "Purple",
  "Black",
] as const;

export const draftKey = (sport: Draft["sport"], id: string) => `logbook-draft:${sport}:${id}`;

export const unitKey = "logbook-unit";

export function loggedFigures(summary: LoggedSummary) {
  if (summary.sport === "strength") {
    const figures = [{ name: "sets", label: "Sets", value: String(summary.sets), unit: "" }];
    if (summary.volumeKg !== null) {
      const [value, unit] = formatVolume(summary.volumeKg, summary.unit).split(" ");
      figures.push({ name: "volume", label: "Volume", value: value!, unit: unit! });
    }
    return figures;
  }
  const figures = [
    { name: "tops", label: "Tops", value: `${summary.tops}/${summary.problems}`, unit: "" },
  ];
  const hardest = gradeValueText(summary.hardestTop);
  if (hardest) figures.push({ name: "hardest", label: "Hardest", value: hardest, unit: "" });
  return figures;
}
