import {
  encodeFitWorkout,
  fitText,
  type FitWorkoutDuration,
  type FitWorkoutStep,
  type FitWorkoutTarget,
  type Intensity as FitIntensity,
  maxWorkoutSteps,
  workoutHeartRateBpmOffset,
  workoutPowerWattsOffset,
} from "@trainstack/fit";
import { type Converted, IssueLog } from "./issues.ts";
import type { Block, Duration, Intensity, Level, Repeat, Step, Target, Workout } from "./model.ts";
import { formatNumber } from "./numbers.ts";
import { checkedInput } from "./validate.ts";

export type FitWriteOptions = {
  thresholdHeartRate?: number | undefined;
  thresholdPace?: number | undefined;
  approximate?: boolean | undefined;
  timeCreated?: Date | undefined;
};

export const staircaseSecondsPerStep = 60;
export const staircaseMetersPerStep = 200;

const fitIntensities: Record<Intensity, FitIntensity> = {
  warmUp: "warmup",
  active: "active",
  recovery: "recovery",
  rest: "rest",
  coolDown: "cooldown",
};

const maxUint32 = 0xfffffffe;
const maxPercentFtp = 1000;
const allOut = "All out";

type Ends = { low: number; high: number };

function rampRange(
  target: Exclude<Target, { type: "maxEffort" }>,
  level: Extract<Level, { kind: "ramp" }>,
): string {
  const share = (value: number) => `${formatNumber(Number((value * 100).toFixed(2)))}%`;
  const plain = (value: number) => formatNumber(value);
  const shared = target.unit === "ftp" || target.unit === "threshold";
  const suffix = {
    power: target.unit === "ftp" ? "of FTP" : "W",
    heartRate: target.unit === "threshold" ? "of threshold heart rate" : "bpm",
    pace: target.unit === "threshold" ? "of threshold pace" : "m/s",
  }[target.type];
  const format = shared ? share : plain;
  return `from ${format(level.from)} to ${format(level.to)} ${suffix}`;
}

function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

function stepsCount(block: Block, written: (step: Step) => number): number {
  return block.type === "step"
    ? written(block)
    : block.count * block.steps.reduce((sum, child) => sum + stepsCount(child, written), 0);
}

type Plan = { keep: boolean; cost: number };

class FitWriter {
  private readonly log = new IssueLog("fit");
  private readonly options: FitWriteOptions;
  private readonly steps: FitWorkoutStep[] = [];
  private readonly warned = new Set<string>();
  private readonly failed = new Set<string>();

  constructor(options: FitWriteOptions) {
    this.options = options;
  }

  write(workout: Workout): Converted<Uint8Array> {
    const input = checkedInput(this.log, workout);
    if (!input) return this.log.result(new Uint8Array());
    if (input.description) this.warn("dropped", "The description has no place in a .fit file");
    if (input.focus) this.warn("dropped", `Focus "${input.focus}" has no place in a .fit file`);
    if (input.author) this.warn("dropped", `Author "${input.author}" has no place in a .fit file`);
    if (input.tags) this.warn("dropped", "Tags have no place in a .fit file");
    const total = input.steps.reduce((sum, block) => sum + this.plan(block).cost, 0);
    if (total > maxWorkoutSteps) {
      return this.log.abort(
        "unsupported",
        `The workout needs ${total} FIT steps, more than the ${maxWorkoutSteps} a file can hold`,
      );
    }
    input.steps.forEach((block, index) => this.block(block, `steps.${index}`, false));
    if (this.log.errors.length > 0) return this.log.result(new Uint8Array());
    return this.log.result(
      encodeFitWorkout(
        { name: this.text(input.name, "the name"), sport: input.sport, steps: this.steps },
        { timeCreated: this.options.timeCreated },
      ),
    );
  }

  private written(step: Step): number {
    const level = step.target && "level" in step.target ? step.target.level : undefined;
    if (level?.kind !== "ramp" || !this.options.approximate) return 1;
    return this.stairs(step.duration);
  }

  private stairs(duration: Duration): number {
    return duration.type === "time"
      ? Math.max(2, Math.ceil(duration.seconds / staircaseSecondsPerStep))
      : Math.max(2, Math.ceil(duration.meters / staircaseMetersPerStep));
  }

  private plan(block: Block): Plan {
    if (block.type === "step") return { keep: false, cost: this.written(block) };
    const keep =
      1 +
      block.steps.reduce((sum, child) => sum + stepsCount(child, (step) => this.written(step)), 0);
    const expand = block.count * block.steps.reduce((sum, child) => sum + this.plan(child).cost, 0);
    return keep <= expand ? { keep: true, cost: keep } : { keep: false, cost: expand };
  }

  private block(block: Block, at: string, insideRepeat: boolean): void {
    if (block.type === "step") {
      this.step(block, at);
      return;
    }
    const keep = !insideRepeat && this.plan(block).keep;
    if (!keep) this.expand(block, at, insideRepeat);
    else this.keep(block, at);
  }

  private keep(repeat: Repeat, at: string): void {
    const fromStep = this.steps.length;
    this.repeatCues(repeat, at);
    repeat.steps.forEach((child, index) => this.block(child, `${at}.steps.${index}`, true));
    this.steps.push({
      name: this.text(repeat.name, "the name", at),
      duration: { type: "repeat", fromStep, count: repeat.count },
    });
  }

  private expand(repeat: Repeat, at: string, insideRepeat: boolean): void {
    this.warn(
      "expanded",
      insideRepeat
        ? `The repeat is written out ${repeat.count} times, because FIT repeats cannot nest`
        : `The repeat is written out ${repeat.count} times, which takes fewer FIT steps than repeats nested inside a FIT repeat would`,
      at,
    );
    if (repeat.name) this.warn("dropped", `Name "${repeat.name}" is not kept`, at);
    this.repeatCues(repeat, at);
    for (let round = 0; round < repeat.count; round++) {
      repeat.steps.forEach((child, index) =>
        this.block(child, `${at}.steps.${index}`, insideRepeat),
      );
    }
  }

  private repeatCues(repeat: Repeat, at: string): void {
    for (const cue of repeat.cues ?? []) {
      this.warn("dropped", `Cue "${cue.text}" has no place in a .fit file`, at);
    }
  }

  private step(step: Step, at: string): void {
    for (const cue of step.cues ?? []) {
      this.warn("dropped", `Cue "${cue.text}" has no place in a .fit file`, at);
    }
    const cadence = step.cadence && this.cadence(step.cadence, at);
    const base: FitWorkoutStep = {
      name: this.text(step.name, "the name", at),
      notes: this.text(step.notes, "the notes", at),
      intensity: step.intensity && fitIntensities[step.intensity],
      duration: { type: "open" },
    };
    const target = step.target;
    if (target?.type === "maxEffort") {
      if (!this.options.approximate) {
        this.fail("unsupported", "A max effort has no place in a .fit file", at);
        return;
      }
      this.warn(
        "approximated",
        `The max effort is written as a step with no target named "${allOut}"`,
        at,
      );
      this.push({
        ...base,
        name: step.name
          ? this.text(`${step.name} (${allOut.toLowerCase()})`, "the name", at)
          : allOut,
        intensity: base.intensity ?? "active",
        duration: this.duration(step.duration, at),
        ...this.targets(undefined, cadence),
      });
      return;
    }
    const level = target && target.level;
    if (target && level?.kind === "ramp") {
      this.ramp(step, target, level, base, cadence, at);
      return;
    }
    this.push({
      ...base,
      duration: this.duration(step.duration, at),
      ...this.targets(target && level && this.target(target, level, at), cadence),
    });
  }

  private ramp(
    step: Step,
    target: Exclude<Target, { type: "maxEffort" }>,
    level: Extract<Level, { kind: "ramp" }>,
    base: FitWorkoutStep,
    cadence: FitWorkoutTarget | undefined,
    at: string,
  ): void {
    if (!this.options.approximate) {
      this.fail("unsupported", "A ramp has no place in a .fit file", at);
      return;
    }
    const count = this.stairs(step.duration);
    const parts = this.split(step.duration, count, at);
    const [length, per, symbol] =
      step.duration.type === "time"
        ? [step.duration.seconds, staircaseSecondsPerStep, "s"]
        : [step.duration.meters, staircaseMetersPerStep, "m"];
    this.warn(
      "approximated",
      `The ramp ${rampRange(target, level)} is written as ${count} steady steps of ${formatNumber(Number((length / count).toFixed(3)))} ${symbol}, one per ${per} ${symbol} and at least two, each at the ramp's level at its midpoint, which keeps its length and average to FIT's precision`,
      at,
    );
    parts.forEach((duration, index) => {
      const value = level.from + ((level.to - level.from) * (index + 0.5)) / count;
      this.push({
        ...base,
        notes: index === 0 ? base.notes : undefined,
        duration,
        ...this.targets(this.target(target, { kind: "constant", value }, at, true), cadence),
      });
    });
  }

  private split(duration: Duration, count: number, at: string): FitWorkoutDuration[] {
    const whole =
      duration.type === "time"
        ? this.integer(duration.seconds * 1000, "The step's length in milliseconds", at)
        : this.integer(duration.meters * 100, "The step's length in centimetres", at);
    const base = Math.floor(whole / count);
    if (base === 0) {
      this.fail("unsupported", `The ramp is too short to write as ${count} steps`, at);
      return [];
    }
    return Array.from({ length: count }, (_, index) => {
      const amount = base + (index < whole - base * count ? 1 : 0);
      return duration.type === "time"
        ? { type: "time", seconds: amount / 1000 }
        : { type: "distance", meters: amount / 100 };
    });
  }

  private integer(value: number, what: string, at: string, quiet = false, max = maxUint32): number {
    const rounded = Math.round(value);
    if (rounded > max) {
      this.fail("unsupported", `${what} is too large for a .fit file`, at);
      return 0;
    }
    if (!quiet && !sameNumber(rounded, value)) {
      this.warn(
        "approximated",
        `${what} is rounded from ${formatNumber(value)} to ${rounded}, the precision of a .fit file`,
        at,
      );
    }
    return rounded;
  }

  private duration(duration: Duration, at: string): FitWorkoutDuration {
    if (duration.type === "time") {
      const milliseconds = this.integer(
        duration.seconds * 1000,
        "The step's length in milliseconds",
        at,
      );
      if (milliseconds === 0)
        this.fail("unsupported", "The step is shorter than a millisecond", at);
      return { type: "time", seconds: milliseconds / 1000 };
    }
    const centimetres = this.integer(duration.meters * 100, "The step's length in centimetres", at);
    if (centimetres === 0) this.fail("unsupported", "The step is shorter than a centimetre", at);
    return { type: "distance", meters: centimetres / 100 };
  }

  private ends(level: Exclude<Level, { kind: "ramp" }>): Ends {
    return level.kind === "constant"
      ? { low: level.value, high: level.value }
      : { low: level.low, high: level.high };
  }

  private target(
    target: Exclude<Target, { type: "maxEffort" }>,
    level: Level,
    at: string,
    quiet = false,
  ): FitWorkoutTarget | undefined {
    if (level.kind === "ramp") return undefined;
    const { low, high } = this.ends(level);
    switch (target.type) {
      case "power": {
        if (target.unit === "ftp") {
          const percent = (value: number) =>
            this.integer(value * 100, "Power as a percentage of FTP", at, quiet);
          const ends = { low: percent(low), high: percent(high) };
          if (ends.high > maxPercentFtp) {
            this.fail(
              "unsupported",
              `Power above ${maxPercentFtp}% of FTP has no place in a .fit file`,
              at,
            );
          }
          return {
            type: "power",
            averaging: "instant",
            low: { unit: "percentFtp", value: ends.low },
            high: { unit: "percentFtp", value: ends.high },
          };
        }
        const watts = (value: number) => {
          const rounded = this.integer(
            value,
            "Power in watts",
            at,
            quiet,
            maxUint32 - workoutPowerWattsOffset,
          );
          return rounded === 0
            ? ({ unit: "percentFtp", value: 0 } as const)
            : ({ unit: "watts", value: rounded } as const);
        };
        return { type: "power", averaging: "instant", low: watts(low), high: watts(high) };
      }
      case "heartRate": {
        const threshold = this.options.thresholdHeartRate;
        if (target.unit === "threshold" && threshold === undefined) {
          this.fail(
            "unsupported",
            "Heart rate as a share of threshold needs a threshold heart rate to become bpm in a .fit file",
            at,
          );
          return undefined;
        }
        const factor = target.unit === "threshold" ? threshold! : 1;
        if (target.unit === "threshold") {
          this.warn(
            "converted",
            `Heart rate as a share of threshold is written in bpm from a threshold heart rate of ${formatNumber(factor)} bpm`,
            at,
          );
        }
        const bpm = (value: number) => {
          const rounded = this.integer(
            value * factor,
            "Heart rate in bpm",
            at,
            quiet,
            maxUint32 - workoutHeartRateBpmOffset,
          );
          return rounded === 0
            ? ({ unit: "percentMaxHeartRate", value: 0 } as const)
            : ({ unit: "bpm", value: rounded } as const);
        };
        return { type: "heartRate", averaging: "instant", low: bpm(low), high: bpm(high) };
      }
      case "pace": {
        const threshold = this.options.thresholdPace;
        if (target.unit === "threshold" && threshold === undefined) {
          this.fail(
            "unsupported",
            "Pace as a share of threshold needs a threshold pace to become speed in a .fit file",
            at,
          );
          return undefined;
        }
        const factor = target.unit === "threshold" ? threshold! : 1;
        if (target.unit === "threshold") {
          this.warn(
            "converted",
            `Pace as a share of threshold is written as speed from a threshold pace of ${formatNumber(factor)} m/s`,
            at,
          );
        }
        const speed = (value: number) =>
          this.integer(value * factor * 1000, "Speed in millimetres per second", at, quiet) / 1000;
        return { type: "speed", averaging: "instant", low: speed(low), high: speed(high) };
      }
    }
  }

  private cadence(cadence: NonNullable<Step["cadence"]>, at: string): FitWorkoutTarget {
    const { low, high } = this.ends(cadence);
    return {
      type: "cadence",
      low: this.integer(low, "Cadence", at),
      high: this.integer(high, "Cadence", at),
    };
  }

  private targets(
    target: FitWorkoutTarget | undefined,
    cadence: FitWorkoutTarget | undefined,
  ): Pick<FitWorkoutStep, "target" | "secondaryTarget"> {
    if (!target) return { target: cadence };
    return { target, secondaryTarget: cadence };
  }

  private text(value: string | undefined, what: string, at?: string): string | undefined {
    if (value === undefined) return undefined;
    const kept = fitText(value);
    if (kept !== value) {
      this.warn(
        "dropped",
        `Only the first ${[...kept].length} characters of ${what} fit in a .fit file`,
        at,
      );
    }
    return kept;
  }

  private fail(code: "unsupported", message: string, at?: string): void {
    const key = `${code}\n${message}\n${at ?? ""}`;
    if (this.failed.has(key)) return;
    this.failed.add(key);
    this.log.fail(code, message, at);
  }

  private warn(
    code: "dropped" | "expanded" | "approximated" | "converted",
    message: string,
    at?: string,
  ): void {
    const key = `${code}\n${message}\n${at ?? ""}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.log.warn(code, message, at);
  }

  private push(step: FitWorkoutStep): void {
    this.steps.push(step);
  }
}

export function writeFit(workout: Workout, options: FitWriteOptions = {}): Converted<Uint8Array> {
  return new FitWriter(options).write(workout);
}
