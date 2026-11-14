import {
  type Block,
  type Cadence,
  CuePlacementError,
  type Level,
  type MeasuredDuration,
  type Repeat,
  type Sport,
  type Step,
  type Target,
  type Workout,
  flatten,
  workoutSchema,
} from "@trainstack/workout";

import { measuredLength, unknownOpenSeconds } from "./workout-profile.ts";

export type Path = readonly number[];

export const pathKey = (path: Path) => path.join(".");

export const parsePath = (key: string): Path =>
  key === "" ? [] : key.split(".").map((part) => Number(part));

const samePath = (a: Path, b: Path) =>
  a.length === b.length && a.every((part, index) => part === b[index]);

const isWithin = (path: Path, ancestor: Path) =>
  path.length > ancestor.length && ancestor.every((part, index) => path[index] === part);

export function blockAt(blocks: readonly Block[], path: Path): Block | undefined {
  const [head, ...rest] = path;
  if (head === undefined) return undefined;
  const block = blocks[head];
  if (!block || rest.length === 0) return block;
  return block.type === "repeat" ? blockAt(block.steps, rest) : undefined;
}

function mapAt(
  blocks: readonly Block[],
  parent: Path,
  change: (siblings: Block[]) => Block[],
): Block[] {
  const [head, ...rest] = parent;
  if (head === undefined) return change([...blocks]);
  return blocks.map((block, index) => {
    if (index !== head || block.type !== "repeat") return block;
    return { ...block, steps: mapAt(block.steps, rest, change) };
  });
}

export function updateBlock(
  blocks: readonly Block[],
  path: Path,
  change: (block: Block) => Block,
): Block[] {
  const parent = path.slice(0, -1);
  const index = path.at(-1)!;
  return mapAt(blocks, parent, (siblings) =>
    siblings.map((block, at) => (at === index ? change(block) : block)),
  );
}

export function updateStep(
  blocks: readonly Block[],
  path: Path,
  change: (step: Step) => Step,
): Block[] {
  return updateBlock(blocks, path, (block) => (block.type === "step" ? change(block) : block));
}

export function updateRepeat(
  blocks: readonly Block[],
  path: Path,
  change: (repeat: Repeat) => Repeat,
): Block[] {
  return updateBlock(blocks, path, (block) => (block.type === "repeat" ? change(block) : block));
}

function pruneEmpty(blocks: readonly Block[]): Block[] {
  return blocks.flatMap((block): Block[] => {
    if (block.type === "step") return [block];
    const steps = pruneEmpty(block.steps);
    return steps.length === 0 ? [] : [{ ...block, steps }];
  });
}

export function removeBlocks(blocks: readonly Block[], paths: readonly Path[]): Block[] {
  const doomed = new Set(paths.map(pathKey));
  const keep = (list: readonly Block[], prefix: Path): Block[] =>
    list.flatMap((block, index): Block[] => {
      const path = [...prefix, index];
      if (doomed.has(pathKey(path))) return [];
      if (block.type === "repeat") return [{ ...block, steps: keep(block.steps, path) }];
      return [block];
    });
  return pruneEmpty(keep(blocks, []));
}

export function insertAt(
  blocks: readonly Block[],
  path: Path,
  inserted: readonly Block[],
): Block[] {
  const parent = path.slice(0, -1);
  const index = path.at(-1)!;
  return mapAt(blocks, parent, (siblings) => [
    ...siblings.slice(0, index),
    ...inserted,
    ...siblings.slice(index),
  ]);
}

export const nextPath = (path: Path, offset = 1): Path => [
  ...path.slice(0, -1),
  path.at(-1)! + offset,
];

export function siblingCount(blocks: readonly Block[], path: Path) {
  const parent = path.slice(0, -1);
  if (parent.length === 0) return blocks.length;
  const block = blockAt(blocks, parent);
  return block?.type === "repeat" ? block.steps.length : 0;
}

export function pathAfterMove(path: Path, from: Path, to: Path): Path {
  const parent = from.slice(0, -1);
  const depth = parent.length;
  if (path.length <= depth || !parent.every((part, index) => path[index] === part)) return path;
  const index = path[depth]!;
  const moved = from[depth]!;
  const target = to[depth]!;
  const shifted =
    index === moved
      ? target
      : moved < target && index > moved && index <= target
        ? index - 1
        : moved > target && index >= target && index < moved
          ? index + 1
          : index;
  return [...path.slice(0, depth), shifted, ...path.slice(depth + 1)];
}

export function moveBlock(
  blocks: readonly Block[],
  path: Path,
  offset: -1 | 1,
): { blocks: Block[]; path: Path } | null {
  const index = path.at(-1)!;
  const target = index + offset;
  if (target < 0 || target >= siblingCount(blocks, path)) return null;
  const parent = path.slice(0, -1);
  const moved = mapAt(blocks, parent, (siblings) => {
    const next = [...siblings];
    const [block] = next.splice(index, 1);
    next.splice(target, 0, block!);
    return next;
  });
  return { blocks: moved, path: [...parent, target] };
}

export function duplicateBlock(
  blocks: readonly Block[],
  path: Path,
): { blocks: Block[]; path: Path } {
  const block = blockAt(blocks, path);
  if (!block) return { blocks: [...blocks], path };
  const copy = structuredClone(block);
  return { blocks: insertAt(blocks, nextPath(path), [copy]), path: nextPath(path) };
}

export function groupable(
  paths: readonly Path[],
): { parent: Path; from: number; to: number } | null {
  if (paths.length === 0) return null;
  const parent = paths[0]!.slice(0, -1);
  if (!paths.every((path) => samePath(path.slice(0, -1), parent))) return null;
  const indices = paths.map((path) => path.at(-1)!).sort((a, b) => a - b);
  const from = indices[0]!;
  const to = indices.at(-1)!;
  if (indices.length !== to - from + 1) return null;
  return { parent, from, to };
}

export function groupIntoRepeat(
  blocks: readonly Block[],
  paths: readonly Path[],
  count = 2,
): { blocks: Block[]; path: Path } | null {
  const range = groupable(paths);
  if (!range) return null;
  const grouped = mapAt(blocks, range.parent, (siblings) => {
    const inner = siblings.slice(range.from, range.to + 1);
    const repeat: Repeat = { type: "repeat", count, steps: inner };
    return [...siblings.slice(0, range.from), repeat, ...siblings.slice(range.to + 1)];
  });
  return { blocks: grouped, path: [...range.parent, range.from] };
}

export function ungroup(blocks: readonly Block[], path: Path): Block[] {
  const block = blockAt(blocks, path);
  if (block?.type !== "repeat") return [...blocks];
  const parent = path.slice(0, -1);
  const index = path.at(-1)!;
  return mapAt(blocks, parent, (siblings) => [
    ...siblings.slice(0, index),
    ...block.steps,
    ...siblings.slice(index + 1),
  ]);
}

export function newStep(sport: Sport, after?: Step): Step {
  if (after)
    return { ...structuredClone(after), name: undefined, notes: undefined, cues: undefined };
  const duration =
    sport === "swimming"
      ? { type: "distance" as const, meters: 100 }
      : { type: "time" as const, seconds: 300 };
  const target: Target =
    sport === "cycling"
      ? { type: "power", unit: "ftp", level: { kind: "constant", value: 0.6 } }
      : { type: "pace", unit: "threshold", level: { kind: "constant", value: 0.8 } };
  return { type: "step", duration, target };
}

export function blankWorkout(sport: Sport): Workout {
  return { name: "New workout", sport, steps: [newStep(sport)] };
}

export function withLevelKind(level: Level, kind: Level["kind"]): Level {
  if (level.kind === kind) return level;
  const [low, high] =
    level.kind === "constant"
      ? [level.value, level.value]
      : level.kind === "range"
        ? [level.low, level.high]
        : [level.from, level.to];
  const middle = round((low + high) / 2);
  switch (kind) {
    case "constant":
      return { kind, value: middle };
    case "range":
      return low === high
        ? {
            kind,
            low: round(Math.max(0, middle - spread(middle))),
            high: round(middle + spread(middle)),
          }
        : { kind, low: Math.min(low, high), high: Math.max(low, high) };
    case "ramp":
      return low === high
        ? { kind, from: round(middle * 0.8), to: middle }
        : { kind, from: low, to: high };
  }
}

const isShare = (value: number) => value < 10;

const round = (value: number) =>
  isShare(value) ? Math.round(value * 100) / 100 : Math.round(value);

const spread = (middle: number) => (isShare(middle) ? 0.05 : Math.round(middle * 0.05));

export function scaleLevel(level: Level, factor: number, digits: number): Level {
  const scale = (value: number) => Number((value * factor).toFixed(digits));
  switch (level.kind) {
    case "constant":
      return { kind: "constant", value: scale(level.value) };
    case "range":
      return { kind: "range", low: scale(level.low), high: scale(level.high) };
    case "ramp":
      return { kind: "ramp", from: scale(level.from), to: scale(level.to) };
  }
}

export type Thresholds = {
  readonly ftp: number | null;
  readonly thresholdSpeed: number | null;
  readonly thresholdHeartRate: number | null;
};

type LevelTarget = Exclude<Target, { type: "maxEffort" }>;

const defaultTargets: Record<LevelTarget["type"], LevelTarget> = {
  power: { type: "power", unit: "ftp", level: { kind: "constant", value: 0.6 } },
  pace: { type: "pace", unit: "threshold", level: { kind: "constant", value: 0.8 } },
  heartRate: { type: "heartRate", unit: "threshold", level: { kind: "constant", value: 0.8 } },
};

const thresholdFor = (type: LevelTarget["type"], thresholds: Thresholds) =>
  type === "power"
    ? thresholds.ftp
    : type === "pace"
      ? thresholds.thresholdSpeed
      : thresholds.thresholdHeartRate;

export function withTargetType(
  target: Target | undefined,
  type: Target["type"] | "free",
): Target | undefined {
  if (type === "free") return undefined;
  if (type === "maxEffort") return { type: "maxEffort" };
  if (target?.type === type) return target;
  const fallback = defaultTargets[type];
  if (
    target &&
    target.type !== "maxEffort" &&
    (target.unit === "ftp" || target.unit === "threshold")
  ) {
    return { ...fallback, level: target.level } as LevelTarget;
  }
  return fallback;
}

export function withUnit(target: LevelTarget, unit: string, thresholds: Thresholds): LevelTarget {
  if (target.unit === unit) return target;
  const threshold = thresholdFor(target.type, thresholds);
  const toRelative = unit === "ftp" || unit === "threshold";
  const absoluteDigits = target.type === "pace" ? 2 : 0;
  const level =
    threshold === null
      ? toRelative
        ? defaultTargets[target.type].level
        : scaleLevel(
            defaultTargets[target.type].level,
            target.type === "power" ? 250 : target.type === "pace" ? 3.5 : 160,
            absoluteDigits,
          )
      : toRelative
        ? scaleLevel(target.level, 1 / threshold, 3)
        : scaleLevel(target.level, threshold, absoluteDigits);
  return { ...target, unit, level } as LevelTarget;
}

export function withDurationType(
  step: Step,
  type: "time" | "distance",
  secondsPerMeter: number,
): Step {
  if (step.duration.type === type) return step;
  const length = measuredLength(step);
  const seconds =
    length === undefined
      ? unknownOpenSeconds
      : length.type === "time"
        ? length.seconds
        : length.meters * secondsPerMeter;
  const duration: MeasuredDuration =
    length?.type === type
      ? length
      : type === "time"
        ? { type: "time", seconds: Math.max(1, Math.round(seconds)) }
        : {
            type: "distance",
            meters: Math.max(1, Math.round(seconds / secondsPerMeter / 10) * 10),
          };
  return { ...step, duration, cues: step.cues?.filter((cue) => cue.at.type === type) };
}

export function withCadence(
  cadence: Cadence | undefined,
  kind: Cadence["kind"] | "none",
  sport: Sport,
): Cadence | undefined {
  if (kind === "none") return undefined;
  const base = sport === "running" ? 170 : 90;
  if (cadence?.kind === kind) return cadence;
  if (kind === "constant")
    return {
      kind,
      value: cadence?.kind === "range" ? Math.round((cadence.low + cadence.high) / 2) : base,
    };
  const middle = cadence?.kind === "constant" ? cadence.value : base;
  return { kind, low: middle - 5, high: middle + 5 };
}

export type Problem = { readonly path: string; readonly field: string; readonly message: string };

function repeatWithBadCues(blocks: readonly Block[], prefix: Path = []): Path | null {
  for (const [index, block] of blocks.entries()) {
    if (block.type !== "repeat") continue;
    const path = [...prefix, index];
    const inner = repeatWithBadCues(block.steps, path);
    if (inner) return inner;
    try {
      flatten([block]);
    } catch (error) {
      if (error instanceof CuePlacementError) return path;
      if (error instanceof RangeError) return null;
      throw error;
    }
  }
  return null;
}

export function problemsOf(workout: Workout): Problem[] {
  const parsed = workoutSchema.safeParse(workout);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => {
    const segments = issue.path.map(String);
    if (segments[0] !== "steps" || segments.length === 1) {
      if (segments[0] === "steps") {
        const repeat = repeatWithBadCues(workout.steps);
        return {
          path: repeat ? pathKey(repeat) : "",
          field: repeat ? "cues" : "steps",
          message: issue.message,
        };
      }
      return { path: "", field: segments.join("."), message: issue.message };
    }
    const path: number[] = [];
    let rest = segments.slice(1);
    while (rest.length > 0 && /^\d+$/.test(rest[0]!)) {
      path.push(Number(rest[0]));
      if (rest[1] === "steps") rest = rest.slice(2);
      else {
        rest = rest.slice(1);
        break;
      }
    }
    return { path: pathKey(path), field: rest.join("."), message: issue.message };
  });
}

export function problemsByPath(problems: readonly Problem[]) {
  const map = new Map<string, Problem[]>();
  for (const problem of problems)
    map.set(problem.path, [...(map.get(problem.path) ?? []), problem]);
  return map;
}

export type History = {
  readonly draft: Workout;
  readonly past: readonly Workout[];
  readonly future: readonly Workout[];
  readonly lastKey: string | null;
  readonly lastAt: number;
};

export const startHistory = (draft: Workout): History => ({
  draft,
  past: [],
  future: [],
  lastKey: null,
  lastAt: 0,
});

export const COALESCE_MS = 1500;

export function edit(
  history: History,
  next: Workout,
  key: string | null = null,
  at = Date.now(),
): History {
  if (next === history.draft) return history;
  const coalesce = key !== null && key === history.lastKey && at - history.lastAt < COALESCE_MS;
  return {
    draft: next,
    past: coalesce ? history.past : [...history.past, history.draft].slice(-200),
    future: [],
    lastKey: key,
    lastAt: at,
  };
}

export function undo(history: History): History {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    draft: previous,
    past: history.past.slice(0, -1),
    future: [history.draft, ...history.future],
    lastKey: null,
    lastAt: 0,
  };
}

export function redo(history: History): History {
  const next = history.future[0];
  if (!next) return history;
  return {
    draft: next,
    past: [...history.past, history.draft],
    future: history.future.slice(1),
    lastKey: null,
    lastAt: 0,
  };
}

export const isWithinPath = isWithin;
