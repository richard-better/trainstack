import {
  type BodyArea,
  type CheckIn,
  checkInAnchors,
  type CheckInItem,
  checkInItems,
  type CheckInRatings,
  type IllnessKind,
  type InjuryTraining,
  MAX_CHECK_IN_NOTE,
} from "@trainstack/contract";

import { daysBetween, shiftDay } from "./training.ts";

export { checkInItems, MAX_CHECK_IN_NOTE };
export type { CheckIn, CheckInItem };

export const NORMAL = 3;

export const itemTitles: Record<CheckInItem, string> = {
  sleep: "Sleep",
  energy: "Energy",
  soreness: "Soreness",
  stress: "Stress",
  mood: "Mood",
};

export const itemQuestions: Record<CheckInItem, string> = {
  sleep: "How did you sleep?",
  energy: "How fresh do you feel?",
  soreness: "How do your muscles feel?",
  stress: "How stressed are you?",
  mood: "How is your mood?",
};

export const anchorOf = (item: CheckInItem, value: number) => checkInAnchors[item][value - 1]!;

export const illnessKinds: readonly { key: IllnessKind; label: string }[] = [
  { key: "respiratory", label: "Cold, cough or sore throat" },
  { key: "stomach", label: "Stomach or gut" },
  { key: "fever", label: "Fever or aching all over" },
  { key: "other", label: "Something else" },
];

export const bodyAreas: readonly { key: BodyArea; label: string }[] = [
  { key: "head", label: "Head" },
  { key: "neck", label: "Neck" },
  { key: "shoulder", label: "Shoulder" },
  { key: "upper_arm", label: "Upper arm" },
  { key: "elbow", label: "Elbow" },
  { key: "forearm", label: "Forearm" },
  { key: "wrist", label: "Wrist" },
  { key: "hand", label: "Hand or fingers" },
  { key: "chest", label: "Chest or ribs" },
  { key: "upper_back", label: "Upper back" },
  { key: "lower_back", label: "Lower back" },
  { key: "abdomen", label: "Abdomen" },
  { key: "hip_groin", label: "Hip or groin" },
  { key: "thigh", label: "Thigh" },
  { key: "knee", label: "Knee" },
  { key: "lower_leg", label: "Lower leg or calf" },
  { key: "ankle", label: "Ankle" },
  { key: "foot", label: "Foot or toes" },
];

export const injuryTrainings: readonly { key: InjuryTraining; label: string }[] = [
  { key: "full", label: "Training fully" },
  { key: "reduced", label: "Training less" },
  { key: "none", label: "Cannot train" },
];

const labelIn = <Key extends string>(list: readonly { key: Key; label: string }[], key: Key) =>
  list.find((entry) => entry.key === key)!.label;

export const illnessLabel = (kind: IllnessKind) => labelIn(illnessKinds, kind);
export const bodyAreaLabel = (area: BodyArea) => labelIn(bodyAreas, area);
export const injuryTrainingLabel = (training: InjuryTraining) => labelIn(injuryTrainings, training);

export type Draft = {
  ratings: CheckInRatings;
  illness: { kind: IllnessKind | null } | null;
  injury: { area: BodyArea | null; training: InjuryTraining | null } | null;
  note: string;
};

const allNormal: CheckInRatings = {
  sleep: NORMAL,
  energy: NORMAL,
  soreness: NORMAL,
  stress: NORMAL,
  mood: NORMAL,
};

export function draftOf(checkIn: CheckIn | null): Draft {
  if (!checkIn) return { ratings: allNormal, illness: null, injury: null, note: "" };
  return {
    ratings: checkIn.ratings,
    illness: checkIn.illness && { ...checkIn.illness },
    injury: checkIn.injury && { ...checkIn.injury },
    note: checkIn.note ?? "",
  };
}

export const isComplete = (draft: Draft) =>
  (draft.illness === null || draft.illness.kind !== null) &&
  (draft.injury === null || (draft.injury.area !== null && draft.injury.training !== null));

export const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

export function writeOf(draft: Draft, day: string, now = new Date()): CheckIn {
  const note = draft.note.trim();
  return {
    day,
    ratings: draft.ratings,
    illness: draft.illness?.kind ? { kind: draft.illness.kind } : null,
    injury:
      draft.injury?.area && draft.injury.training
        ? { area: draft.injury.area, training: draft.injury.training }
        : null,
    note: note === "" ? null : note,
    updatedAt: now,
  };
}

const answersOf = ({ day: _day, updatedAt: _updatedAt, ...answers }: CheckIn) =>
  JSON.stringify(answers);

export const sameAnswers = (a: CheckIn | null, b: CheckIn | null) =>
  a === null || b === null ? a === b : answersOf(a) === answersOf(b);

export function changedItems(checkIn: CheckIn) {
  return checkInItems.flatMap((item) => {
    const value = checkIn.ratings[item];
    return value === null || value === NORMAL ? [] : [{ item, value }];
  });
}

export function summaryWords(checkIn: CheckIn) {
  const words: string[] = [];
  if (checkIn.illness) words.push(`Ill: ${illnessLabel(checkIn.illness.kind).toLowerCase()}`);
  if (checkIn.injury) {
    words.push(
      `Injured: ${bodyAreaLabel(checkIn.injury.area).toLowerCase()}, ${injuryTrainingLabel(checkIn.injury.training).toLowerCase()}`,
    );
  }
  const changed = changedItems(checkIn);
  for (const { item, value } of changed) {
    words.push(`${itemTitles[item]}: ${anchorOf(item, value).toLowerCase()}`);
  }
  const allRated = checkInItems.every((item) => checkIn.ratings[item] !== null);
  if (allRated && changed.length === 0) {
    words.push(words.length === 0 ? "All normal" : "Everything else normal");
  }
  if (!allRated) {
    for (const item of checkInItems) {
      if (checkIn.ratings[item] === NORMAL) words.push(`${itemTitles[item]}: normal`);
    }
  }
  if (words.length === 0) words.push("Nothing rated");
  return words;
}

export type Span = { from: string; through: string; label: string };

export function spansOf(
  checkIns: readonly CheckIn[],
  labelOf: (checkIn: CheckIn) => string | null,
): Span[] {
  const spans: Span[] = [];
  for (const checkIn of checkIns) {
    const label = labelOf(checkIn);
    if (label === null) continue;
    const last = spans.at(-1);
    if (last && shiftDay(last.through, 1) === checkIn.day && last.label === label) {
      last.through = checkIn.day;
    } else {
      spans.push({ from: checkIn.day, through: checkIn.day, label });
    }
  }
  return spans;
}

const illnessShortLabels: Record<IllnessKind, string> = {
  respiratory: "Cold",
  stomach: "Stomach",
  fever: "Fever",
  other: "Ill",
};

export const illnessSpans = (checkIns: readonly CheckIn[]) =>
  spansOf(checkIns, (checkIn) =>
    checkIn.illness ? illnessShortLabels[checkIn.illness.kind] : null,
  );

export const injurySpans = (checkIns: readonly CheckIn[]) =>
  spansOf(checkIns, (checkIn) => (checkIn.injury ? bodyAreaLabel(checkIn.injury.area) : null));

export const checkInsQueryKey = (from: string, through: string) =>
  ["check-ins", from, through] as const;

export const historyRangeKeys = ["6w", "3m", "6m", "1y"] as const;
export type HistoryRangeKey = (typeof historyRangeKeys)[number];

export function placeCheckIn(
  checkIns: readonly CheckIn[],
  day: string,
  held: CheckIn | null,
): CheckIn[] {
  const others = checkIns.filter((entry) => entry.day !== day);
  return (held ? [...others, held] : others).toSorted((a, b) => a.day.localeCompare(b.day));
}

export type HistoryDay = { day: string; fatigue: number | null; checkIn: CheckIn | null };

export function historyDays(
  from: string,
  through: string,
  fatigueByDay: ReadonlyMap<string, number>,
  checkIns: readonly CheckIn[],
): HistoryDay[] {
  const byDay = new Map(checkIns.map((checkIn) => [checkIn.day, checkIn]));
  return Array.from({ length: daysBetween(from, through) + 1 }, (_, index) => {
    const day = shiftDay(from, index);
    return { day, fatigue: fatigueByDay.get(day) ?? null, checkIn: byDay.get(day) ?? null };
  });
}

const longDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

export function dayHeading(day: string, today: string) {
  const date = longDay.format(new Date(`${day}T00:00:00Z`));
  if (day === today) return { title: "Today", date };
  if (day === shiftDay(today, -1)) return { title: "Yesterday", date };
  return { title: date, date: null };
}

export const historyRangeDays: Record<HistoryRangeKey, number> = {
  "6w": 42,
  "3m": 91,
  "6m": 182,
  "1y": 365,
};

export const historyRangeLabels: Record<HistoryRangeKey, string> = {
  "6w": "6 weeks",
  "3m": "3 months",
  "6m": "6 months",
  "1y": "1 year",
};
