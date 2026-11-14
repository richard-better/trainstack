import type { Block, Cadence, Level, Sport, Step, Target, Workout } from "@trainstack/workout";
import {
  metricSettings,
  paceDistanceMetres,
  type Profile,
  type ZoneMetric,
  type ZoneSet,
  zoneContaining,
  zonesOf,
} from "@trainstack/zones";

export type Reference = {
  readonly sport: Sport;
  readonly ftp: number | null;
  readonly thresholdSpeed: number | null;
  readonly thresholdHeartRate: number | null;
  readonly paceDistance: number;
  readonly zones: Partial<Record<ZoneMetric, ZoneSet>>;
};

const metricOf = {
  power: "power",
  pace: "pace",
  heartRate: "heart_rate",
} as const satisfies Record<Exclude<Target["type"], "maxEffort">, ZoneMetric>;

export function referenceFor(profile: Profile | null, sport: Sport): Reference {
  const paceDistance = paceDistanceMetres(sport) ?? 1000;
  const settings = (metric: ZoneMetric) =>
    profile ? metricSettings(profile, metric, sport) : null;
  const power = settings("power");
  const pace = settings("pace");
  const heartRate = settings("heart_rate");
  const zones: Partial<Record<ZoneMetric, ZoneSet>> = {};
  for (const [metric, value] of [
    ["power", power],
    ["pace", pace],
    ["heart_rate", heartRate],
  ] as const) {
    const set = value && zonesOf(value);
    if (set) zones[metric] = set;
  }
  const thresholdPace = pace?.thresholds.threshold_pace;
  return {
    sport,
    ftp: power?.thresholds.ftp ?? null,
    thresholdSpeed: thresholdPace ? paceDistance / thresholdPace : null,
    thresholdHeartRate: heartRate?.thresholds.lactate_threshold_heart_rate ?? null,
    paceDistance,
    zones,
  };
}

export const noReference = (sport: Sport): Reference => referenceFor(null, sport);

type LevelTarget = Exclude<Target, { type: "maxEffort" }>;

function thresholdOf(target: LevelTarget, reference: Reference): number | null {
  switch (target.type) {
    case "power":
      return reference.ftp;
    case "pace":
      return reference.thresholdSpeed;
    case "heartRate":
      return reference.thresholdHeartRate;
  }
}

const isRelative = (target: LevelTarget) => target.unit === "ftp" || target.unit === "threshold";

export function absolute(target: LevelTarget, value: number, reference: Reference): number | null {
  if (!isRelative(target)) return value;
  const threshold = thresholdOf(target, reference);
  return threshold === null ? null : value * threshold;
}

export function share(target: LevelTarget, value: number, reference: Reference): number | null {
  if (isRelative(target)) return value;
  const threshold = thresholdOf(target, reference);
  return threshold === null ? null : value / threshold;
}

export const levelEnds = (level: Level): [number, number] => {
  switch (level.kind) {
    case "constant":
      return [level.value, level.value];
    case "range":
      return [level.low, level.high];
    case "ramp":
      return [level.from, level.to];
  }
};

export const levelMiddle = (level: Level) => {
  const [a, b] = levelEnds(level);
  return (a + b) / 2;
};

const meanSquare = (level: Level) => {
  if (level.kind === "ramp") return (level.from ** 2 + level.from * level.to + level.to ** 2) / 3;
  return levelMiddle(level) ** 2;
};

const cruisingSpeed: Record<Sport, number> = { cycling: 8.3, running: 3, swimming: 1 };

function speedOf(step: Step, reference: Reference): number {
  const target = step.target;
  if (target?.type === "pace") {
    const speed = absolute(target, levelMiddle(target.level), reference);
    if (speed !== null && speed > 0) return speed;
  }
  if (reference.thresholdSpeed !== null && reference.sport !== "cycling") {
    return reference.thresholdSpeed * 0.85;
  }
  return cruisingSpeed[reference.sport];
}

export function stepSeconds(step: Step, reference: Reference) {
  if (step.duration.type === "time") return { seconds: step.duration.seconds, estimated: false };
  return { seconds: step.duration.meters / speedOf(step, reference), estimated: true };
}

export type ZoneMark = { readonly index: number; readonly count: number; readonly label: string };

export type Segment = {
  readonly key: string;
  readonly path: readonly number[];
  readonly step: Step;
  readonly start: number;
  readonly seconds: number;
  readonly estimated: boolean;
  readonly shape: "level" | "range" | "ramp" | "free" | "max";
  readonly from: number;
  readonly to: number;
  readonly low: number;
  readonly high: number;
  readonly scaled: boolean;
  readonly zone: ZoneMark | null;
};

const shareZoneStarts = [0.55, 0.75, 0.9, 1.05, 1.2];
const shareZoneLabels = ["1", "2", "3", "4", "5", "6"];

function zoneByShare(value: number): ZoneMark {
  const index = shareZoneStarts.filter((start) => value >= start).length;
  return { index, count: shareZoneLabels.length, label: shareZoneLabels[index]! };
}

function zoneOf(target: Target | undefined, reference: Reference): ZoneMark | null {
  if (!target) return null;
  if (target.type === "maxEffort") {
    return { index: shareZoneLabels.length - 1, count: shareZoneLabels.length, label: "Max" };
  }
  const middle = levelMiddle(target.level);
  const set = reference.zones[metricOf[target.type]];
  const value = absolute(target, middle, reference);
  if (set && value !== null) {
    const measured =
      target.type === "pace" ? (value > 0 ? reference.paceDistance / value : Infinity) : value;
    const zone = zoneContaining(set, Math.round(measured));
    return { index: zone.index, count: set.zones.length, label: zone.label };
  }
  const relative = share(target, middle, reference);
  return relative === null ? null : zoneByShare(relative);
}

export type Placed = {
  readonly step: Step;
  readonly path: readonly number[];
  readonly key: string;
};

export function placedSteps(blocks: readonly Block[], prefix: readonly number[] = []): Placed[] {
  return blocks.flatMap((block, index) => {
    const path = [...prefix, index];
    if (block.type === "step") return [{ step: block, path, key: path.join(".") }];
    const once = placedSteps(block.steps, path);
    return Array.from({ length: block.count }, (_, round) =>
      once.map((placed) => ({ ...placed, key: `${placed.key}#${round}` })),
    ).flat();
  });
}

function absoluteScale(steps: readonly Placed[], reference: Reference) {
  const scale: Partial<Record<LevelTarget["type"], number>> = {};
  for (const { step } of steps) {
    const target = step.target;
    if (!target || target.type === "maxEffort") continue;
    if (share(target, 1, reference) !== null) continue;
    const top = Math.max(...levelEnds(target.level));
    scale[target.type] = Math.max(scale[target.type] ?? 0, top);
  }
  return scale;
}

export const MAX_EFFORT_SHARE = 1.5;
export const FREE_RIDE_SHARE = 0.5;

export function segmentsOf(workout: Pick<Workout, "steps">, reference: Reference): Segment[] {
  const steps = placedSteps(workout.steps);
  const scale = absoluteScale(steps, reference);
  let start = 0;
  return steps.map(({ step, path, key }) => {
    const { seconds, estimated } = stepSeconds(step, reference);
    const target = step.target;
    const base = { key, path, step, start, seconds, estimated, zone: zoneOf(target, reference) };
    start += seconds;
    if (!target) {
      const level = FREE_RIDE_SHARE;
      return {
        ...base,
        shape: "free",
        from: level,
        to: level,
        low: level,
        high: level,
        scaled: false,
      };
    }
    if (target.type === "maxEffort") {
      const level = MAX_EFFORT_SHARE;
      return {
        ...base,
        shape: "max",
        from: level,
        to: level,
        low: level,
        high: level,
        scaled: false,
      };
    }
    const relative = (value: number) => share(target, value, reference);
    const scaled = relative(1) === null;
    const height = (value: number) =>
      scaled ? value / (scale[target.type] || 1) : (relative(value) ?? 0);
    const [first, second] = levelEnds(target.level);
    const shape = target.level.kind === "constant" ? "level" : target.level.kind;
    return {
      ...base,
      shape,
      from: height(shape === "range" ? (first + second) / 2 : first),
      to: height(shape === "range" ? (first + second) / 2 : second),
      low: height(first),
      high: height(second),
      scaled,
    };
  });
}

export type Load = { readonly score: number; readonly intensityFactor: number };

function stepMeanSquare(step: Step, reference: Reference): number | null {
  const target = step.target;
  if (!target) return FREE_RIDE_SHARE ** 2;
  if (target.type === "maxEffort") return MAX_EFFORT_SHARE ** 2;
  const unit = share(target, 1, reference);
  if (unit === null) return null;
  return meanSquare(target.level) * unit ** 2;
}

export function loadOf(segments: readonly Segment[], reference: Reference): Load | null {
  let weighted = 0;
  let seconds = 0;
  for (const segment of segments) {
    const square = stepMeanSquare(segment.step, reference);
    if (square === null) return null;
    weighted += square * segment.seconds;
    seconds += segment.seconds;
  }
  if (seconds === 0) return null;
  return {
    score: Math.round((weighted / 3600) * 100),
    intensityFactor: Math.sqrt(weighted / seconds),
  };
}

export function averagePower(segments: readonly Segment[], reference: Reference): number | null {
  let work = 0;
  let seconds = 0;
  for (const segment of segments) {
    const target = segment.step.target;
    if (target?.type !== "power") return null;
    const middle = absolute(target, levelMiddle(target.level), reference);
    if (middle === null) return null;
    work += middle * segment.seconds;
    seconds += segment.seconds;
  }
  return seconds > 0 ? Math.round(work / seconds) : null;
}

export type Overview = {
  readonly segments: Segment[];
  readonly seconds: number;
  readonly estimated: boolean;
  readonly meters: number;
  readonly load: Load | null;
  readonly averagePower: number | null;
};

export function overviewOf(workout: Pick<Workout, "steps">, reference: Reference): Overview {
  const segments = segmentsOf(workout, reference);
  const last = segments.at(-1);
  return {
    segments,
    seconds: last ? last.start + last.seconds : 0,
    estimated: segments.some((segment) => segment.estimated),
    meters: segments.reduce(
      (sum, { step }) => sum + (step.duration.type === "distance" ? step.duration.meters : 0),
      0,
    ),
    load: loadOf(segments, reference),
    averagePower: averagePower(segments, reference),
  };
}

export function formatSpan(seconds: number) {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const parts = [
    hours > 0 ? `${hours} h` : null,
    minutes > 0 ? `${minutes} min` : null,
    rest > 0 || total === 0 ? `${rest} s` : null,
  ];
  return parts.filter(Boolean).join(" ");
}

export function formatClock(seconds: number) {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}` : `${minutes} min`;
}

export const formatMinutes = (seconds: number) => `${Math.max(1, Math.round(seconds / 60))} min`;

export function formatMeters(meters: number) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${Number((meters / 1000).toFixed(2))} km`;
}

export const durationText = (step: Step) =>
  step.duration.type === "time"
    ? formatSpan(step.duration.seconds)
    : formatMeters(step.duration.meters);

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function formatPace(speed: number, paceDistance: number) {
  if (!(speed > 0)) return "-";
  const total = Math.round(paceDistance / speed);
  const unit = paceDistance === 100 ? "/100 m" : "/km";
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} ${unit}`;
}

function spread(values: readonly string[], kind: Level["kind"], unit = "") {
  const [a, b] = values;
  const tail = unit ? ` ${unit}` : "";
  if (kind === "constant") return `${a}${tail}`;
  if (kind === "range")
    return `${a?.endsWith("%") && b?.endsWith("%") ? a.slice(0, -1) : a}-${b}${tail}`;
  return `${a} to ${b}${tail}`;
}

const thresholdName: Record<LevelTarget["type"], string> = {
  power: "FTP",
  pace: "threshold pace",
  heartRate: "threshold HR",
};

function absoluteText(target: LevelTarget, values: readonly number[], reference: Reference) {
  const kind = target.level.kind;
  switch (target.type) {
    case "power":
      return spread(
        values.map((value) => String(Math.round(value))),
        kind,
        "W",
      );
    case "heartRate":
      return spread(
        values.map((value) => String(Math.round(value))),
        kind,
        "bpm",
      );
    case "pace": {
      const paces = values.map((value) => formatPace(value, reference.paceDistance));
      const unit = paces[0]!.split(" ").slice(1).join(" ");
      return spread(
        paces.map((pace) => pace.split(" ")[0]!),
        kind,
        unit,
      );
    }
  }
}

export type TargetText = { readonly main: string; readonly detail: string | null };

const freeName: Record<Sport, string> = {
  cycling: "Free ride",
  running: "Free run",
  swimming: "Free swim",
};

export function targetText(target: Target | undefined, reference: Reference): TargetText {
  if (!target) return { main: freeName[reference.sport], detail: null };
  if (target.type === "maxEffort") return { main: "All out", detail: null };
  const ends = target.level.kind === "constant" ? [target.level.value] : levelEnds(target.level);
  if (isRelative(target)) {
    const main = spread(ends.map(percent), target.level.kind, thresholdName[target.type]);
    const threshold = thresholdOf(target, reference);
    return {
      main,
      detail:
        threshold === null
          ? null
          : absoluteText(
              target,
              ends.map((value) => value * threshold),
              reference,
            ),
    };
  }
  const main = absoluteText(target, ends, reference);
  const threshold = thresholdOf(target, reference);
  return {
    main,
    detail:
      threshold === null
        ? null
        : spread(
            ends.map((value) => percent(value / threshold)),
            target.level.kind,
            thresholdName[target.type],
          ),
  };
}

export function cadenceText(cadence: Cadence | undefined, sport: Sport) {
  if (!cadence) return null;
  const unit = sport === "running" ? "spm" : "rpm";
  return cadence.kind === "constant"
    ? `${cadence.value} ${unit}`
    : `${cadence.low}-${cadence.high} ${unit}`;
}

export const intensityNames = {
  warmUp: "Warm up",
  active: "Active",
  recovery: "Recovery",
  rest: "Rest",
  coolDown: "Cool down",
} as const;

export const focusNames = {
  recovery: "Recovery",
  endurance: "Endurance",
  tempo: "Tempo",
  threshold: "Threshold",
  vo2Max: "VO2 max",
  anaerobic: "Anaerobic",
} as const;

export const sportNames: Record<Sport, string> = {
  cycling: "Cycling",
  running: "Running",
  swimming: "Swimming",
};

export function stepTitle(step: Step, reference: Reference) {
  return (
    step.name ??
    (step.intensity ? intensityNames[step.intensity] : null) ??
    targetText(step.target, reference).main
  );
}
