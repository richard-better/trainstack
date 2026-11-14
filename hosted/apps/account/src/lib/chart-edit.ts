import type { Level, Step, Target } from "@trainstack/workout";

import { type Reference, share } from "./workout-profile.ts";

type LevelTarget = Exclude<Target, { type: "maxEffort" }>;

export type LevelPart = "whole" | "from" | "to";

const levelTarget = (step: Step): LevelTarget | null =>
  step.target && step.target.type !== "maxEffort" ? step.target : null;

export function canDragLevel(step: Step, reference: Reference) {
  const target = levelTarget(step);
  return target !== null && share(target, 1, reference) !== null;
}

function amountFor(target: LevelTarget, relative: number, reference: Reference): number {
  if (target.unit === "ftp" || target.unit === "threshold")
    return Number(Math.max(0, relative).toFixed(2));
  const value = relative / (share(target, 1, reference) ?? 1);
  if (target.unit === "metersPerSecond") return Number(Math.max(0, value).toFixed(3));
  return Math.max(0, Math.round(value));
}

function levelShare(target: LevelTarget, value: number, reference: Reference) {
  return share(target, value, reference) ?? value;
}

export function partAt(level: Level, fraction: number): LevelPart {
  if (level.kind !== "ramp") return "whole";
  return fraction < 0.5 ? "from" : "to";
}

export function withLevelShare(
  step: Step,
  part: LevelPart,
  from: number,
  to: number,
  reference: Reference,
): Step {
  const target = levelTarget(step);
  if (!target || !canDragLevel(step, reference)) return step;
  const level = target.level;
  const unit = (value: number) => levelShare(target, value, reference);
  const set = (value: number) => amountFor(target, value, reference);
  const delta = to - from;
  let next: Level;
  switch (level.kind) {
    case "constant":
      next = { kind: "constant", value: set(unit(level.value) + delta) };
      break;
    case "range": {
      const low = Math.max(0, unit(level.low) + delta);
      const width = unit(level.high) - unit(level.low);
      next = { kind: "range", low: set(low), high: set(low + width) };
      break;
    }
    case "ramp":
      next =
        part === "from"
          ? { ...level, from: set(unit(level.from) + delta) }
          : part === "to"
            ? { ...level, to: set(unit(level.to) + delta) }
            : { ...level, from: set(unit(level.from) + delta), to: set(unit(level.to) + delta) };
      break;
  }
  return { ...step, target: { ...target, level: next } as LevelTarget };
}

export function snapSeconds(seconds: number) {
  const step = seconds < 120 ? 5 : 15;
  return Math.max(step, Math.round(seconds / step) * step);
}

export function withLength(step: Step, seconds: number, metersPerSecond: number): Step {
  if (step.duration.type === "open") return step;
  if (step.duration.type === "time")
    return { ...step, duration: { type: "time", seconds: snapSeconds(seconds) } };
  const meters = Math.max(10, Math.round((seconds * metersPerSecond) / 10) * 10);
  return { ...step, duration: { type: "distance", meters } };
}

export function nudgeLevel(
  step: Step,
  direction: 1 | -1,
  big: boolean,
  reference: Reference,
): Step {
  const target = levelTarget(step);
  if (!target || !canDragLevel(step, reference)) return step;
  const amount = (big ? 0.05 : 0.01) * direction;
  const [first] =
    target.level.kind === "constant"
      ? [target.level.value]
      : target.level.kind === "range"
        ? [target.level.low]
        : [target.level.from];
  const base = levelShare(target, first, reference);
  return withLevelShare(step, "whole", base, base + amount, reference);
}

export function nudgeLength(step: Step, direction: 1 | -1): Step {
  const nudged = (current: number, amount: number, start: number) =>
    direction > 0 ? start + amount : Math.min(current, Math.max(1, start - amount));
  if (step.duration.type === "open") return step;
  if (step.duration.type === "time") {
    const seconds = step.duration.seconds;
    const amount = seconds < 120 ? 5 : 15;
    return {
      ...step,
      duration: { type: "time", seconds: nudged(seconds, amount, snapSeconds(seconds)) },
    };
  }
  const meters = step.duration.meters;
  const amount = meters < 400 ? 25 : 100;
  return { ...step, duration: { type: "distance", meters: nudged(meters, amount, meters) } };
}

export const draggedSeconds = (
  seconds: number,
  fromX: number,
  x: number,
  secondsPerPixel: number,
) => Math.max(1, seconds + (x - fromX) * secondsPerPixel);
