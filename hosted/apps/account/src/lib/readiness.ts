import type {
  DayReadiness,
  PlannedContent,
  PlannedWorkout,
  ReadinessLevel,
  ReadinessReason,
  ReadinessSuggestion,
} from "@trainstack/contract";
import { loadHistoryDays } from "@trainstack/readiness";
import type { Workout } from "@trainstack/workout";

import { anchorOf, bodyAreaLabel, illnessLabel, itemTitles } from "./check-in.ts";
import { plannedName, positionAt } from "./calendar.ts";
import type { CalendarWrites } from "./calendar-writes.ts";

export type { DayReadiness, ReadinessLevel, ReadinessReason, ReadinessSuggestion };

export const readinessKey = ["readiness"] as const;
export const readinessQueryKey = (from: string, through: string) =>
  [...readinessKey, from, through] as const;

export const levelSteps: Record<ReadinessLevel, number> = { ready: 4, fair: 3, low: 2, poor: 1 };

export const levelWords: Record<ReadinessLevel, { title: string; line: string }> = {
  ready: { title: "Ready", line: "Nothing points against your plan." },
  fair: { title: "Fair", line: "Some strain. Go easier on the hard parts." },
  low: { title: "Low", line: "Run down. Keep today easy." },
  poor: { title: "Poor", line: "Rest today." },
};

export function headlineOf(readiness: DayReadiness) {
  if (readiness.level === null) {
    return {
      title: "Not enough to go on",
      line: "Check in, and readiness reads your answers against your usual.",
    };
  }
  const first = readiness.reasons[0];
  if (first?.kind === "ill") return { title: "Poor", line: "You said you are ill. Rest today." };
  if (first?.kind === "injured" && first.training === "none") {
    return { title: "Poor", line: "You said your injury stops you training. Rest today." };
  }
  return levelWords[readiness.level];
}

const formWords = {
  fresh: "Fresh",
  neutral: "Neutral",
  building: "Productive",
  deep: "Overreaching",
} as const;

const percentOf = (share: number) => `${Math.round(Math.abs(share) * 100)} %`;

const nearestRating = (usual: number) => Math.min(5, Math.max(1, Math.round(usual)));

export type ReasonLine = { readonly effect: "lowers" | "steady" | "raises"; readonly text: string };

export function reasonLine(reason: ReadinessReason): ReasonLine {
  switch (reason.kind) {
    case "ill":
      return {
        effect: "lowers",
        text: `Ill: ${illnessLabel(reason.illness).toLowerCase()}`,
      };
    case "injured":
      return {
        effect: reason.training === "full" ? "steady" : "lowers",
        text: `Injured: ${bodyAreaLabel(reason.area).toLowerCase()}, ${
          { full: "training fully", reduced: "training less", none: "cannot train" }[
            reason.training
          ]
        }`,
      };
    case "recently_ill":
      return {
        effect: "lowers",
        text: `Ill ${reason.daysAgo === 1 ? "yesterday" : `${reason.daysAgo} days ago`}: coming back gently`,
      };
    case "check_in": {
      const said = anchorOf(reason.item, reason.rating);
      const usual = anchorOf(reason.item, nearestRating(reason.usual)).toLowerCase();
      const against = reason.against === "own" ? `usually ${usual}` : "against normal";
      return { effect: reason.effect, text: `${itemTitles[reason.item]}: ${said}, ${against}` };
    }
    case "form":
      return {
        effect: reason.effect,
        text:
          reason.band === "deep"
            ? `Form ${formWords.deep.toLowerCase()}: fatigue ${percentOf(reason.share)} above fitness`
            : reason.band === "fresh"
              ? `Form fresh: ${percentOf(reason.share)} above fitness`
              : `Form ${formWords[reason.band].toLowerCase()}`,
      };
    case "ramp":
      return {
        effect: reason.effect,
        text: `Fitness up ${Math.round(reason.perWeek)} in a week: a fast ramp`,
      };
    case "hard_days":
      return { effect: reason.effect, text: `${reason.days} hard days in a row` };
  }
}

export function reasonLines(readiness: DayReadiness): ReasonLine[] {
  const lines: ReasonLine[] = [];
  const steadyItems: string[] = [];
  for (const reason of readiness.reasons) {
    if (reason.kind === "check_in" && reason.effect === "steady") {
      steadyItems.push(itemTitles[reason.item]);
      continue;
    }
    lines.push(reasonLine(reason));
  }
  if (steadyItems.length > 0) {
    lines.push({ effect: "steady", text: `${listed(steadyItems)} as usual` });
  }
  return lines;
}

function listed(words: readonly string[]) {
  if (words.length <= 1) return words.join("");
  const lower = words.map((word, index) => (index === 0 ? word : word.toLowerCase()));
  return `${lower.slice(0, -1).join(", ")} and ${lower.at(-1)}`;
}

export function gapLines(readiness: DayReadiness): string[] {
  return readiness.gaps.map((gap) => {
    switch (gap.kind) {
      case "no_check_in":
        return "No check-in today, so this comes from your training alone.";
      case "short_baseline":
        return `${gap.checkIns} of 7 check-ins in the last four weeks rated what you rated today: until there are 7, those answers are read against normal rather than your own usual.`;
      case "no_training":
        return "No training yet, so this comes from your check-in alone.";
      case "short_training_history":
        return `${gap.days} days of training so far: training load counts once there are ${loadHistoryDays}.`;
      case "little_training":
        return "Too little recent training to read form.";
    }
  });
}

export const confidenceWords = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
} as const;

export const unmeasuredLine =
  "Not read: measured sleep, resting heart rate and HRV, which TrainStack does not have yet.";

export const intensityWords = {
  easy: "Easy",
  moderate: "Moderate",
  hard: "Hard",
  unknown: "Intensity not known",
} as const;

export const actionWords: Record<ReadinessSuggestion["action"], { title: string; line: string }> = {
  as_planned: { title: "As planned", line: "Go ahead with it." },
  ease: {
    title: "Ease it",
    line: "Keep the session, but hold the hard parts at the low end of their targets, or cut a repeat.",
  },
  swap_easy: {
    title: "Swap for easy",
    line: "Do an easy session instead, up to an hour, at a pace you could talk at.",
  },
  rest: { title: "Rest", line: "Skip it today." },
};

export const EASY_SECONDS = 3600;

type Step = Extract<Workout["steps"][number], { type: "step" }>;

const easySteps: Record<Workout["sport"], Step["target"]> = {
  cycling: { type: "power", unit: "ftp", level: { kind: "range", low: 0.55, high: 0.75 } },
  running: { type: "pace", unit: "threshold", level: { kind: "range", low: 0.65, high: 0.8 } },
  swimming: { type: "pace", unit: "threshold", level: { kind: "range", low: 0.65, high: 0.8 } },
};

const easyNames: Record<Workout["sport"], string> = {
  cycling: "Easy ride",
  running: "Easy run",
  swimming: "Easy swim",
};

export function easySwapFor(item: PlannedWorkout): PlannedContent | null {
  if (item.content.kind !== "workout") return null;
  const sport = item.content.workout.sport;
  const seconds = Math.min(EASY_SECONDS, Math.round(item.planned?.seconds ?? EASY_SECONDS));
  return {
    kind: "workout",
    workout: {
      name: easyNames[sport],
      sport,
      steps: [
        {
          type: "step",
          duration: { type: "time", seconds: Math.max(60, Math.round(seconds / 60) * 60) },
          target: easySteps[sport],
          intensity: "active",
        },
      ],
    },
    source: null,
    notes: `Instead of ${plannedName(item.content)}, on a low readiness day.`,
  };
}

export const swapSkipReason = "Swapped for an easy session on a low readiness day";
export const restSkipReason = (readiness: DayReadiness) =>
  `Rest on a ${headlineOf(readiness).title.toLowerCase()} readiness day`;

export function swapPosition(day: readonly Pick<PlannedWorkout, "id" | "position">[], id: string) {
  const positions = day.map((item) => item.position).sort((a, b) => a - b);
  const at = day.find((item) => item.id === id);
  if (!at) return positionAt(positions, positions.length);
  return positionAt(positions, positions.indexOf(at.position) + 1);
}

export function swapForEasy(
  writes: Pick<CalendarWrites, "plan" | "skip">,
  item: PlannedWorkout,
  day: readonly PlannedWorkout[],
  today: string,
  id: string = crypto.randomUUID(),
) {
  const content = easySwapFor(item);
  if (!content) return Promise.resolve();
  return Promise.all([
    writes.plan({ id, day: item.day, position: swapPosition(day, item.id), content }, today),
    writes.skip(item, { reason: swapSkipReason }),
  ]).then(() => undefined);
}

export const restFrom = (
  writes: Pick<CalendarWrites, "skip">,
  item: PlannedWorkout,
  readiness: DayReadiness,
) => writes.skip(item, { reason: restSkipReason(readiness) });
