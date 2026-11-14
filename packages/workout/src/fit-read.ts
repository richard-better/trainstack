import {
  decodeFitWorkout,
  FitDecodeError,
  type FitHeartRate,
  type FitPower,
  type FitWorkoutFile,
  type FitWorkoutStep,
  type FitWorkoutTarget,
  readFitFileId,
} from "@trainstack/fit";
import { type Converted, IssueLog, WorkoutFormatError } from "./issues.ts";
import type {
  Block,
  Cadence,
  Duration,
  Intensity,
  Level,
  Sport,
  Step,
  Target,
  Workout,
} from "./model.ts";
import { formatNumber, withoutFloatNoise } from "./numbers.ts";
import { validated } from "./validate.ts";

export type FitZone = { low: number | null; high: number | null };

export type FitZones = {
  heartRate?: readonly FitZone[] | undefined;
  power?: readonly FitZone[] | undefined;
  speed?: readonly FitZone[] | undefined;
  source?: string | undefined;
};

export type FitParseOptions = {
  name?: string | undefined;
  maxHeartRate?: number | undefined;
  zones?: FitZones | undefined;
};

const untitled = "Untitled workout";

const sportsByFitName: Partial<Record<string, Sport>> = {
  cycling: "cycling",
  running: "running",
  swimming: "swimming",
};

const intensities: Partial<Record<string, Intensity>> = {
  active: "active",
  interval: "active",
  rest: "rest",
  warmup: "warmUp",
  cooldown: "coolDown",
  recovery: "recovery",
};

const conditions: Partial<Record<string, string>> = {
  hrLessThan: "heart rate drops below a value",
  hrGreaterThan: "heart rate rises above a value",
  calories: "a number of calories is burned",
  powerLessThan: "power drops below a value",
  powerGreaterThan: "power rises above a value",
  power3sLessThan: "3-second power drops below a value",
  power10sLessThan: "10-second power drops below a value",
  power30sLessThan: "30-second power drops below a value",
  power3sGreaterThan: "3-second power rises above a value",
  power10sGreaterThan: "10-second power rises above a value",
  power30sGreaterThan: "30-second power rises above a value",
  powerLapLessThan: "lap power drops below a value",
  powerLapGreaterThan: "lap power rises above a value",
  trainingPeaksTss: "a training stress score is reached",
  reps: "a number of repetitions is done",
  repetitionTime: "a set of repetitions is done",
  repeatUntilTime: "repeats until a time is reached",
  repeatUntilDistance: "repeats until a distance is reached",
  repeatUntilCalories: "repeats until a number of calories is burned",
  repeatUntilHrLessThan: "repeats until heart rate drops below a value",
  repeatUntilHrGreaterThan: "repeats until heart rate rises above a value",
  repeatUntilPowerLessThan: "repeats until power drops below a value",
  repeatUntilPowerGreaterThan: "repeats until power rises above a value",
  repeatUntilPowerLastLapLessThan: "repeats until last lap power drops below a value",
  repeatUntilMaxPowerLastLapLessThan: "repeats until last lap max power drops below a value",
  repeatUntilTrainingPeaksTss: "repeats until a training stress score is reached",
};

const strokes: Partial<Record<string, string>> = {
  freestyle: "freestyle",
  backstroke: "backstroke",
  breaststroke: "breaststroke",
  butterfly: "butterfly",
  drill: "drill",
  mixed: "mixed",
  im: "individual medley",
};

function stepLabel(index: number, step: FitWorkoutStep): string {
  return step.name ? `Step ${index + 1} ("${step.name}")` : `Step ${index + 1}`;
}

type Placed = { start: number; block: Block };

function level(low: number, high: number): Cadence {
  const [bottom, top] = low <= high ? [low, high] : [high, low];
  return bottom === top
    ? { kind: "constant", value: bottom }
    : { kind: "range", low: bottom, high: top };
}

class FitReader {
  private readonly log = new IssueLog("fit");
  private readonly options: FitParseOptions;

  constructor(options: FitParseOptions) {
    this.options = options;
  }

  read(data: Uint8Array | ArrayBuffer): Converted<Workout> {
    const file = this.decoded(data);
    const sport = this.sport(file);
    const placed: Placed[] = [];
    file.steps.forEach((step, index) => {
      const at = `step ${index + 1}`;
      if (step.duration.type === "repeat") {
        this.repeat(placed, step, index, step.duration.fromStep, step.duration.count, at);
        return;
      }
      const converted = this.step(step, index, at);
      if (converted) placed.push({ start: index, block: converted });
    });
    const fileName = file.name ?? this.options.name;
    if (!fileName) {
      this.log.warn("dropped", `The file has no name, so the workout is called "${untitled}"`);
    }
    if (this.log.errors.length > 0) throw new WorkoutFormatError("fit", this.log.errors);
    const workout: Workout = {
      name: fileName ?? untitled,
      sport,
      steps: placed.map(({ block }) => block),
    };
    return this.log.result(validated(this.log, workout));
  }

  private decoded(data: Uint8Array | ArrayBuffer): FitWorkoutFile {
    try {
      return decodeFitWorkout(data);
    } catch (error) {
      if (!(error instanceof FitDecodeError)) throw error;
      if (error.code === "noWorkout") {
        const type = readFitFileId(data)?.type;
        return this.log.abort(
          "unsupported",
          type === "activity"
            ? "The file is a FIT activity, a record of a session done, not a workout"
            : `The file is a FIT ${typeof type === "string" ? `${type} ` : ""}file with no workout in it`,
        );
      }
      return this.log.abort("malformed", error.message);
    }
  }

  private sport(file: FitWorkoutFile): Sport {
    if (file.sport === undefined) return this.log.abort("malformed", "The workout names no sport");
    const sport = sportsByFitName[String(file.sport)];
    if (!sport) {
      return this.log.abort(
        "unsupported",
        `Sport "${file.sport}" is not one TrainStack plans workouts for: cycling, running or swimming`,
      );
    }
    if (file.subSport !== undefined && file.subSport !== "generic") {
      this.log.warn("dropped", `Sub sport "${file.subSport}" is not kept`);
    }
    if (file.poolLengthMeters !== undefined) {
      this.log.warn("dropped", `Pool length ${formatNumber(file.poolLengthMeters)} m is not kept`);
    }
    return sport;
  }

  private repeat(
    placed: Placed[],
    step: FitWorkoutStep,
    index: number,
    fromStep: number,
    count: number,
    at: string,
  ): void {
    if (fromStep >= index) {
      this.log.fail("malformed", `The repeat goes forward to step ${fromStep + 1}`, at);
      return;
    }
    if (count < 1) {
      this.log.fail("malformed", `The repeat runs ${count} times`, at);
      return;
    }
    const inside: Placed[] = [];
    while (placed.length > 0 && placed[placed.length - 1]!.start >= fromStep) {
      inside.unshift(placed.pop()!);
    }
    if (inside[0]?.start !== fromStep) {
      placed.push(...inside);
      this.log.fail(
        "malformed",
        `The repeat goes back to step ${fromStep + 1}, which does not start a run of steps it can repeat`,
        at,
      );
      return;
    }
    if (step.notes) this.log.warn("dropped", "Notes on a repeat are not kept", at);
    placed.push({
      start: fromStep,
      block: {
        type: "repeat",
        count,
        steps: inside.map(({ block }) => block),
        ...(step.name ? { name: step.name } : {}),
      },
    });
  }

  private step(step: FitWorkoutStep, index: number, at: string): Step | undefined {
    const duration = this.duration(step, index, at);
    let target: Target | undefined;
    let cadence: Cadence | undefined;
    for (const fitTarget of [step.target, step.secondaryTarget]) {
      if (fitTarget === undefined) continue;
      if (fitTarget.type === "cadence") {
        if (cadence) this.log.fail("unsupported", "The step has two cadence targets", at);
        cadence = this.cadence(fitTarget, at);
        continue;
      }
      if (fitTarget.type === "swimStroke") {
        const stroke = strokes[String(fitTarget.stroke)];
        this.log.warn(
          "dropped",
          stroke ? `The ${stroke} stroke is not kept` : "The stroke is not kept",
          at,
        );
        continue;
      }
      const converted = this.target(fitTarget, at);
      if (target && converted) {
        this.log.fail("unsupported", "The step has two targets besides cadence", at);
      }
      target ??= converted;
    }
    if (step.equipment !== undefined && step.equipment !== "none") {
      this.log.warn("dropped", `Equipment "${step.equipment}" is not kept`, at);
    }
    if (!duration) return undefined;
    const intensity =
      step.intensity === undefined ? undefined : intensities[String(step.intensity)];
    return {
      type: "step",
      duration,
      ...(target ? { target } : {}),
      ...(cadence ? { cadence } : {}),
      ...(intensity ? { intensity } : {}),
      ...(step.name ? { name: step.name } : {}),
      ...(step.notes ? { notes: step.notes } : {}),
    };
  }

  private duration(step: FitWorkoutStep, index: number, at: string): Duration | undefined {
    const label = stepLabel(index, step);
    switch (step.duration.type) {
      case "time":
        if (step.duration.seconds > 0) return { type: "time", seconds: step.duration.seconds };
        this.log.fail("malformed", `${label} lasts no time`, at);
        return undefined;
      case "distance":
        if (step.duration.meters > 0) return { type: "distance", meters: step.duration.meters };
        this.log.fail("malformed", `${label} covers no distance`, at);
        return undefined;
      case "open":
        this.log.fail(
          "unsupported",
          `${label} lasts until the lap button is pressed, and TrainStack does not support lap-button steps yet`,
          at,
        );
        return undefined;
      case "repeat":
        return undefined;
      case "other": {
        const type = step.duration.durationType;
        if (type === "time" || type === "distance") {
          this.log.fail("malformed", `${label} has no ${type}`, at);
          return undefined;
        }
        const condition = conditions[String(type)];
        this.log.fail(
          "unsupported",
          condition
            ? `${label} lasts until ${condition}, and TrainStack steps last a time or a distance`
            : `${label} has FIT duration type ${type}, and TrainStack steps last a time or a distance`,
          at,
        );
        return undefined;
      }
    }
  }

  private zone(
    metric: "heartRate" | "power" | "speed",
    zoneNumber: number,
    at: string,
  ): Level | undefined {
    const names = {
      heartRate: { title: "Heart rate", setting: "heart rate zones", unit: "bpm" },
      power: { title: "Power", setting: "power zones", unit: "W" },
      speed: { title: "Speed", setting: "pace zones", unit: "m/s" },
    }[metric];
    const zones = this.options.zones?.[metric];
    if (!zones) {
      this.log.fail(
        "unsupported",
        `${names.title} zone ${zoneNumber} refers to zones of the athlete's own; set ${names.setting} to import it`,
        at,
      );
      return undefined;
    }
    const found = zones[zoneNumber - 1];
    if (!found) {
      this.log.fail(
        "unsupported",
        `${names.title} zone ${zoneNumber} is not one of the ${zones.length} ${names.setting} given`,
        at,
      );
      return undefined;
    }
    if (found.high === null) {
      this.log.fail(
        "unsupported",
        `${names.title} zone ${zoneNumber} has no upper limit, so it cannot become a range`,
        at,
      );
      return undefined;
    }
    const low = found.low ?? 0;
    const source = this.options.zones?.source;
    this.log.warn(
      "converted",
      `${names.title} zone ${zoneNumber} became ${formatNumber(low)}-${formatNumber(found.high)} ${names.unit}${source ? ` from ${source}` : ""}`,
      at,
    );
    return level(low, found.high);
  }

  private target(target: FitWorkoutTarget, at: string): Target | undefined {
    switch (target.type) {
      case "power": {
        if (target.averaging !== "instant") {
          this.log.warn(
            "dropped",
            `The target is ${target.averaging} average power; it is kept as power`,
            at,
          );
        }
        if (target.zone !== undefined) {
          const zoned = this.zone("power", target.zone, at);
          return zoned && { type: "power", unit: "watts", level: zoned };
        }
        const [low, high] = this.sameUnit(target.low, target.high, "percentFtp", at);
        if (!low || !high) return undefined;
        return low.unit === "percentFtp"
          ? {
              type: "power",
              unit: "ftp",
              level: level(withoutFloatNoise(low.value / 100), withoutFloatNoise(high.value / 100)),
            }
          : { type: "power", unit: "watts", level: level(low.value, high.value) };
      }
      case "heartRate": {
        if (target.averaging === "lap") {
          this.log.warn(
            "dropped",
            "The target is lap average heart rate; it is kept as heart rate",
            at,
          );
        }
        if (target.zone !== undefined) {
          const zoned = this.zone("heartRate", target.zone, at);
          return zoned && { type: "heartRate", unit: "bpm", level: zoned };
        }
        const [low, high] = this.sameUnit(target.low, target.high, "percentMaxHeartRate", at);
        if (!low || !high) return undefined;
        if (low.unit === "bpm") {
          return { type: "heartRate", unit: "bpm", level: level(low.value, high.value) };
        }
        const max = this.options.maxHeartRate;
        if (max === undefined) {
          this.log.fail(
            "unsupported",
            `The target is ${formatNumber(low.value)}-${formatNumber(high.value)}% of max heart rate; set a max heart rate to import it`,
            at,
          );
          return undefined;
        }
        const bpm = (percent: number) => withoutFloatNoise((percent / 100) * max);
        this.log.warn(
          "converted",
          `${formatNumber(low.value)}-${formatNumber(high.value)}% of max heart rate became ${formatNumber(bpm(low.value))}-${formatNumber(bpm(high.value))} bpm from a max heart rate of ${formatNumber(max)} bpm`,
          at,
        );
        return { type: "heartRate", unit: "bpm", level: level(bpm(low.value), bpm(high.value)) };
      }
      case "speed": {
        if (target.averaging === "lap") {
          this.log.warn("dropped", "The target is lap average speed; it is kept as speed", at);
        }
        if (target.zone !== undefined) {
          const zoned = this.zone("speed", target.zone, at);
          return zoned && { type: "pace", unit: "metersPerSecond", level: zoned };
        }
        if (target.low === undefined || target.high === undefined) {
          this.log.fail("malformed", "The speed target has no range", at);
          return undefined;
        }
        return { type: "pace", unit: "metersPerSecond", level: level(target.low, target.high) };
      }
      case "other":
        this.log.fail(
          "unsupported",
          `A ${target.targetType} target has no place in a TrainStack workout`,
          at,
        );
        return undefined;
      case "cadence":
      case "swimStroke":
        return undefined;
    }
  }

  private sameUnit<Value extends FitPower | FitHeartRate>(
    low: Value | undefined,
    high: Value | undefined,
    percent: Value["unit"],
    at: string,
  ): [Value, Value] | [undefined, undefined] {
    if (low === undefined || high === undefined) {
      this.log.fail("malformed", "The target has neither a zone nor a range", at);
      return [undefined, undefined];
    }
    if (low.unit === high.unit) return [low, high];
    if (low.unit === percent && low.value === 0) return [{ ...high, value: 0 }, high];
    if (high.unit === percent && high.value === 0) return [low, { ...low, value: 0 }];
    this.log.fail("malformed", "The target's two ends are in different units", at);
    return [undefined, undefined];
  }

  private cadence(
    target: Extract<FitWorkoutTarget, { type: "cadence" }>,
    at: string,
  ): Cadence | undefined {
    if (target.zone !== undefined) {
      this.log.fail(
        "unsupported",
        `Cadence zone ${target.zone} refers to zones TrainStack does not keep`,
        at,
      );
      return undefined;
    }
    if (target.low === undefined || target.high === undefined) {
      this.log.fail("malformed", "The cadence target has no range", at);
      return undefined;
    }
    return level(target.low, target.high);
  }
}

export function parseFit(
  data: Uint8Array | ArrayBuffer,
  options: FitParseOptions = {},
): Converted<Workout> {
  return new FitReader(options).read(data);
}
