import type { PlannedWorkout } from "@trainstack/contract";

import { formatDistance, formatHours, formatLoad } from "./statistics.ts";
import { placedSteps } from "./workout-profile.ts";

type Compliance = NonNullable<PlannedWorkout["compliance"]>;
type Part = NonNullable<Compliance["parts"]["duration"]>;
type Intervals = NonNullable<Compliance["parts"]["intervals"]>;
export type IntervalStep = NonNullable<Intervals["steps"]>[number];

export type Rating = NonNullable<Compliance["rating"]>;

export const ratingWords: Record<Rating, string> = {
  on_target: "On target",
  partly: "Partly",
  off_target: "Off target",
};

export interface PartLine {
  readonly key: "duration" | "distance" | "load" | "intervals";
  readonly name: string;
  readonly planned: string;
  readonly done: string;
  readonly verdict: string;
  readonly score: number;
}

export interface ComplianceWords {
  readonly score: number | null;
  readonly rating: Rating | null;
  readonly label: string;
  readonly why: string;
  readonly provisional: boolean;
  readonly parts: readonly PartLine[];
  readonly unscored: readonly string[];
}

const names = { duration: "Time", distance: "Distance", load: "Load", intervals: "Intervals" };

const distanceText = (meters: number) => {
  const distance = formatDistance(meters);
  return `${distance.value} ${distance.unit}`;
};

const formats = { duration: formatHours, distance: distanceText, load: formatLoad };

function offBy(ratio: number) {
  const percent = Math.round(Math.abs(ratio - 1) * 100);
  if (percent === 0) return "as planned";
  return `${percent}% ${ratio > 1 ? "over" : "under"}`;
}

function partLine(key: "duration" | "distance" | "load", part: Part): PartLine {
  const format = formats[key];
  return {
    key,
    name: names[key],
    planned: format(part.planned),
    done: format(part.done),
    verdict: `${offBy(part.ratio)}${part.score >= 1 ? ", within 20%" : ""}`,
    score: part.score,
  };
}

function intervalsLine(intervals: Intervals): PartLine | null {
  if (intervals.share === null || intervals.score === null) return null;
  return {
    key: "intervals",
    name: names.intervals,
    planned: formatHours(intervals.secondsWithData),
    done: formatHours(intervals.secondsInTarget),
    verdict: `${Math.round(intervals.share * 100)}% of the time in target`,
    score: intervals.score,
  };
}

export const hasLapStep = (item: Pick<PlannedWorkout, "content">) =>
  item.content.kind === "workout" &&
  placedSteps(item.content.workout.steps).some(({ step }) => step.duration.type === "open");

const stepsOf = (item: Pick<PlannedWorkout, "content">) =>
  item.content.kind === "workout"
    ? placedSteps(item.content.workout.steps).map(({ step }) => step)
    : [];

export const hasTargets = (item: Pick<PlannedWorkout, "content">) =>
  stepsOf(item).some((step) => step.target !== undefined && step.target.type !== "maxEffort");

const hasMaxEffort = (item: Pick<PlannedWorkout, "content">) =>
  stepsOf(item).some((step) => step.target?.type === "maxEffort");

const hasDistanceSteps = (item: Pick<PlannedWorkout, "content">) =>
  stepsOf(item).some((step) => step.duration.type === "distance");

function intervalsUnscored(intervals: Intervals | null, item: PlannedWorkout) {
  if (!hasTargets(item)) {
    return hasMaxEffort(item)
      ? "Intervals are not scored: an all-out effort has no target band to hold."
      : "Intervals are not scored: the workout has no targets to hold.";
  }
  const steps = intervals?.steps;
  if (!intervals) {
    return "Intervals are not scored: they need the activity's analysis, and for targets set against a threshold, that threshold in Settings.";
  }
  if (steps && steps.length > 0 && steps.every((step) => !step.placed)) {
    return "Intervals are not scored: its steps could not be found in the activity, which has no lap per step while a step's length was not known in advance.";
  }
  return "Intervals are not scored: no step with a target had data, such as power targets on a ride without a power meter, or the steps could not be found in the activity.";
}

export function complianceWords(item: PlannedWorkout): ComplianceWords | null {
  const compliance = item.compliance;
  if (!compliance) return null;
  const { duration, distance, load, intervals } = compliance.parts;
  const parts = [
    duration && partLine("duration", duration),
    distance && partLine("distance", distance),
    load && partLine("load", load),
    intervals && intervalsLine(intervals),
  ].filter((part): part is PartLine => part !== null);

  const unscored: string[] = [];
  if (!duration && !load && hasLapStep(item)) {
    unscored.push(
      "Time, distance and load are not scored: a step lasts until you press lap, so how long it takes is yours to choose.",
    );
  } else {
    if (!duration) unscored.push("Time is not scored: the plan or the activity has no time.");
    if (!distance && hasDistanceSteps(item)) {
      unscored.push("Distance is not scored: the plan or the activity has no distance.");
    }
    if (!load) {
      unscored.push(
        "Load is not scored: the plan or the activity has no load, which needs your thresholds.",
      );
    }
  }
  if (!intervals || !intervalsLine(intervals)) {
    unscored.push(intervalsUnscored(intervals, item));
  }

  const weakest = parts.toSorted((a, b) => a.score - b.score)[0];
  const why =
    compliance.score === null
      ? (unscored[0] ?? "Not scored.")
      : !weakest || weakest.score >= 1
        ? "On target in every part that was scored."
        : weakest.key === "intervals"
          ? `Intervals pulled it down: ${weakest.verdict}.`
          : `${weakest.name} pulled it down: ${weakest.done} against ${weakest.planned} planned, ${weakest.verdict}.`;

  return {
    score: compliance.score === null ? null : Math.round(compliance.score),
    rating: compliance.rating,
    label: compliance.rating ? ratingWords[compliance.rating] : "Not scored",
    why,
    provisional: compliance.pending,
    parts,
    unscored,
  };
}

export function stepTarget(step: IntervalStep, sport: string | null) {
  const unit = (value: number) => {
    switch (step.metric) {
      case "power":
        return `${Math.round(value)} W`;
      case "heart_rate":
        return `${Math.round(value)} bpm`;
      case "speed":
        if (sport === "running" && value > 0) {
          const seconds = Math.round(1000 / value);
          return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} /km`;
        }
        return `${(value * 3.6).toFixed(1)} km/h`;
    }
  };
  return {
    band: `${unit(step.low)} to ${unit(step.high)}`,
    average: step.average === null ? "-" : unit(step.average),
  };
}
