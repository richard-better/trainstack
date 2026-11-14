import {
  type FitEnum,
  type FitFileId,
  type Sport,
  type SubSport,
  fileId,
  integer,
  named,
  text,
} from "./activity.ts";
import { type EncodedField, FitEncoder } from "./encoder.ts";
import { FitDecodeError } from "./error.ts";
import {
  intensities,
  sports,
  stepDurationTypes,
  stepTargetTypes,
  subSports,
  swimStrokes,
  workoutEquipment,
} from "./names.ts";
import {
  FileIdField,
  MessageNumber,
  Scale,
  WorkoutField,
  WorkoutStepField,
  fitEpochInUnixSeconds,
  workoutHeartRateBpmOffset,
  workoutPowerWattsOffset,
} from "./profile.ts";
import { type FitMessage, forEachFitMessage } from "./reader.ts";

export type Intensity = FitEnum<typeof intensities>;
export type StepDurationType = FitEnum<typeof stepDurationTypes>;
export type StepTargetType = FitEnum<typeof stepTargetTypes>;
export type SwimStroke = FitEnum<typeof swimStrokes>;
export type WorkoutEquipment = FitEnum<typeof workoutEquipment>;

export type FitWorkoutDuration =
  | { readonly type: "time"; readonly seconds: number }
  | { readonly type: "distance"; readonly meters: number }
  | { readonly type: "open" }
  | { readonly type: "repeat"; readonly fromStep: number; readonly count: number }
  | {
      readonly type: "other";
      readonly durationType: StepDurationType;
      readonly durationValue: number | undefined;
      readonly targetValue: number | undefined;
    };

export type FitPower =
  | { readonly unit: "percentFtp"; readonly value: number }
  | { readonly unit: "watts"; readonly value: number };

export type FitHeartRate =
  | { readonly unit: "percentMaxHeartRate"; readonly value: number }
  | { readonly unit: "bpm"; readonly value: number };

export type PowerAveraging = "instant" | "3s" | "10s" | "30s" | "lap";
export type LapAveraging = "instant" | "lap";

export type FitWorkoutTarget =
  | {
      readonly type: "power";
      readonly averaging: PowerAveraging;
      readonly zone?: number | undefined;
      readonly low?: FitPower | undefined;
      readonly high?: FitPower | undefined;
    }
  | {
      readonly type: "heartRate";
      readonly averaging: LapAveraging;
      readonly zone?: number | undefined;
      readonly low?: FitHeartRate | undefined;
      readonly high?: FitHeartRate | undefined;
    }
  | {
      readonly type: "speed";
      readonly averaging: LapAveraging;
      readonly zone?: number | undefined;
      readonly low?: number | undefined;
      readonly high?: number | undefined;
    }
  | {
      readonly type: "cadence";
      readonly zone?: number | undefined;
      readonly low?: number | undefined;
      readonly high?: number | undefined;
    }
  | { readonly type: "swimStroke"; readonly stroke: SwimStroke | undefined }
  | {
      readonly type: "other";
      readonly targetType: StepTargetType;
      readonly value: number | undefined;
      readonly low: number | undefined;
      readonly high: number | undefined;
    };

export interface FitWorkoutStep {
  readonly name?: string | undefined;
  readonly notes?: string | undefined;
  readonly duration: FitWorkoutDuration;
  readonly target?: FitWorkoutTarget | undefined;
  readonly secondaryTarget?: FitWorkoutTarget | undefined;
  readonly intensity?: Intensity | undefined;
  readonly equipment?: WorkoutEquipment | undefined;
}

export interface FitWorkout {
  readonly name?: string | undefined;
  readonly sport?: Sport | undefined;
  readonly subSport?: SubSport | undefined;
  readonly poolLengthMeters?: number | undefined;
  readonly steps: readonly FitWorkoutStep[];
}

export interface FitWorkoutFile extends FitWorkout {
  readonly fileId: FitFileId | undefined;
}

export interface FitWorkoutEncodeOptions {
  readonly timeCreated?: Date | undefined;
}

export const maxWorkoutSteps = 10_000;

const developmentManufacturer = 255;
const workoutFileType = 5;
const zoneIsCustom = 0;
const metricUnits = 0;

const powerAveraging: Record<PowerAveraging, number> = {
  instant: 4,
  "3s": 7,
  "10s": 8,
  "30s": 9,
  lap: 10,
};

const speedAveraging: Record<LapAveraging, number> = { instant: 0, lap: 12 };
const heartRateAveraging: Record<LapAveraging, number> = { instant: 1, lap: 13 };

const TargetType = { open: 2, cadence: 3, swimStroke: 11 } as const;
const DurationType = { time: 0, distance: 1, open: 5, repeat: 6 } as const;

function codeOf<Names extends Record<number, string>>(names: Names, value: FitEnum<Names>): number {
  if (typeof value === "number") return value;
  const entry = Object.entries(names).find(([, name]) => name === value);
  if (!entry) throw new RangeError(`"${value}" is not a FIT name`);
  return Number(entry[0]);
}

function power(raw: number | undefined): FitPower | undefined {
  if (raw === undefined) return undefined;
  return raw > workoutPowerWattsOffset
    ? { unit: "watts", value: raw - workoutPowerWattsOffset }
    : { unit: "percentFtp", value: raw };
}

function heartRate(raw: number | undefined): FitHeartRate | undefined {
  if (raw === undefined) return undefined;
  return raw > workoutHeartRateBpmOffset
    ? { unit: "bpm", value: raw - workoutHeartRateBpmOffset }
    : { unit: "percentMaxHeartRate", value: raw };
}

function speed(raw: number | undefined): number | undefined {
  return raw === undefined ? undefined : raw / Scale.speed;
}

function zone(raw: number | undefined): number | undefined {
  return raw === undefined || raw === zoneIsCustom ? undefined : raw;
}

function target(
  type: number | undefined,
  value: number | undefined,
  low: number | undefined,
  high: number | undefined,
): FitWorkoutTarget | undefined {
  const name = named(stepTargetTypes, type);
  switch (name) {
    case undefined:
    case "open":
      return undefined;
    case "power":
    case "power3s":
    case "power10s":
    case "power30s":
    case "powerLap": {
      const averaging = (Object.entries(powerAveraging).find(([, code]) => code === type)?.[0] ??
        "instant") as PowerAveraging;
      return { type: "power", averaging, zone: zone(value), low: power(low), high: power(high) };
    }
    case "heartRate":
    case "heartRateLap":
      return {
        type: "heartRate",
        averaging: name === "heartRateLap" ? "lap" : "instant",
        zone: zone(value),
        low: heartRate(low),
        high: heartRate(high),
      };
    case "speed":
    case "speedLap":
      return {
        type: "speed",
        averaging: name === "speedLap" ? "lap" : "instant",
        zone: zone(value),
        low: speed(low),
        high: speed(high),
      };
    case "cadence":
      return { type: "cadence", zone: zone(value), low, high };
    case "swimStroke":
      return { type: "swimStroke", stroke: named(swimStrokes, value) };
    default:
      return { type: "other", targetType: name, value, low, high };
  }
}

function duration(message: FitMessage): FitWorkoutDuration {
  const type = integer(message, WorkoutStepField.durationType);
  const value = integer(message, WorkoutStepField.durationValue);
  const targetValue = integer(message, WorkoutStepField.targetValue);
  const name = named(stepDurationTypes, type);
  if (name === "time" && value !== undefined) return { type: "time", seconds: value / Scale.time };
  if (name === "distance" && value !== undefined) {
    return { type: "distance", meters: value / Scale.distance };
  }
  if (name === "open") return { type: "open" };
  if (name === "repeatUntilStepsCmplt" && value !== undefined && targetValue !== undefined) {
    return { type: "repeat", fromStep: value, count: targetValue };
  }
  if (name === undefined) throw new FitDecodeError("malformed");
  return { type: "other", durationType: name, durationValue: value, targetValue };
}

function step(message: FitMessage): FitWorkoutStep {
  const stepDuration = duration(message);
  const carriesTarget = stepDuration.type !== "repeat" && stepDuration.type !== "other";
  return {
    name: text(message, WorkoutStepField.name),
    notes: text(message, WorkoutStepField.notes),
    duration: stepDuration,
    target: carriesTarget
      ? target(
          integer(message, WorkoutStepField.targetType),
          integer(message, WorkoutStepField.targetValue),
          integer(message, WorkoutStepField.customTargetValueLow),
          integer(message, WorkoutStepField.customTargetValueHigh),
        )
      : undefined,
    secondaryTarget: carriesTarget
      ? target(
          integer(message, WorkoutStepField.secondaryTargetType),
          integer(message, WorkoutStepField.secondaryTargetValue),
          integer(message, WorkoutStepField.secondaryCustomTargetValueLow),
          integer(message, WorkoutStepField.secondaryCustomTargetValueHigh),
        )
      : undefined,
    intensity: named(intensities, integer(message, WorkoutStepField.intensity)),
    equipment: named(workoutEquipment, integer(message, WorkoutStepField.equipment)),
  };
}

export function readFitFileId(data: Uint8Array | ArrayBuffer): FitFileId | undefined {
  let found: FitFileId | undefined;
  forEachFitMessage(data, (message) => {
    if (message.globalNumber === MessageNumber.fileId) found ??= fileId(message);
  });
  return found;
}

export function decodeFitWorkout(data: Uint8Array | ArrayBuffer): FitWorkoutFile {
  let fileIdMessage: FitMessage | undefined;
  let workoutMessage: FitMessage | undefined;
  const steps: FitWorkoutStep[] = [];
  forEachFitMessage(data, (message) => {
    switch (message.globalNumber) {
      case MessageNumber.fileId:
        fileIdMessage ??= message;
        break;
      case MessageNumber.workout:
        workoutMessage ??= message;
        break;
      case MessageNumber.workoutStep:
        if (steps.length >= maxWorkoutSteps) throw new FitDecodeError("tooLarge");
        steps.push(step(message));
        break;
    }
  });
  const id = fileIdMessage && fileId(fileIdMessage);
  if ((id !== undefined && id.type !== "workout") || steps.length === 0) {
    throw new FitDecodeError("noWorkout");
  }
  const poolLength = workoutMessage && integer(workoutMessage, WorkoutField.poolLength);
  return {
    fileId: id,
    name: workoutMessage && text(workoutMessage, WorkoutField.name),
    sport: workoutMessage && named(sports, integer(workoutMessage, WorkoutField.sport)),
    subSport: workoutMessage && named(subSports, integer(workoutMessage, WorkoutField.subSport)),
    poolLengthMeters: poolLength === undefined ? undefined : poolLength / Scale.distance,
    steps,
  };
}

type Field = EncodedField | undefined;

function uint32(number: number, value: number | undefined): Field {
  return value === undefined ? undefined : { number, type: "uint32", value };
}

function rounded(value: number, scale = 1): number {
  return Math.round(value * scale);
}

function powerValue(value: FitPower | undefined): number | undefined {
  if (value === undefined) return undefined;
  const raw = rounded(value.value);
  return value.unit === "watts" && raw > 0 ? raw + workoutPowerWattsOffset : raw;
}

function heartRateValue(value: FitHeartRate | undefined): number | undefined {
  if (value === undefined) return undefined;
  const raw = rounded(value.value);
  return value.unit === "bpm" && raw > 0 ? raw + workoutHeartRateBpmOffset : raw;
}

function speedValue(value: number | undefined): number | undefined {
  return value === undefined ? undefined : rounded(value, Scale.speed);
}

function optional(value: number | undefined): number | undefined {
  return value === undefined ? undefined : rounded(value);
}

interface TargetFields {
  readonly type: number;
  readonly value: number | undefined;
  readonly low: number | undefined;
  readonly high: number | undefined;
}

function targetFields(value: FitWorkoutTarget | undefined): TargetFields {
  if (value === undefined)
    return { type: TargetType.open, value: undefined, low: undefined, high: undefined };
  const custom = (zoneNumber: number | undefined) => zoneNumber ?? zoneIsCustom;
  switch (value.type) {
    case "power":
      return {
        type: powerAveraging[value.averaging],
        value: custom(value.zone),
        low: powerValue(value.low),
        high: powerValue(value.high),
      };
    case "heartRate":
      return {
        type: heartRateAveraging[value.averaging],
        value: custom(value.zone),
        low: heartRateValue(value.low),
        high: heartRateValue(value.high),
      };
    case "speed":
      return {
        type: speedAveraging[value.averaging],
        value: custom(value.zone),
        low: speedValue(value.low),
        high: speedValue(value.high),
      };
    case "cadence":
      return {
        type: TargetType.cadence,
        value: custom(value.zone),
        low: optional(value.low),
        high: optional(value.high),
      };
    case "swimStroke":
      return {
        type: TargetType.swimStroke,
        value: value.stroke === undefined ? undefined : codeOf(swimStrokes, value.stroke),
        low: undefined,
        high: undefined,
      };
    case "other":
      return {
        type: codeOf(stepTargetTypes, value.targetType),
        value: value.value,
        low: value.low,
        high: value.high,
      };
  }
}

function durationFields(value: FitWorkoutDuration): Field[] {
  const type = (code: number): Field => ({
    number: WorkoutStepField.durationType,
    type: "enum",
    value: code,
  });
  switch (value.type) {
    case "time":
      return [
        type(DurationType.time),
        uint32(WorkoutStepField.durationValue, rounded(value.seconds, Scale.time)),
      ];
    case "distance":
      return [
        type(DurationType.distance),
        uint32(WorkoutStepField.durationValue, rounded(value.meters, Scale.distance)),
      ];
    case "open":
      return [type(DurationType.open)];
    case "repeat":
      return [
        type(DurationType.repeat),
        uint32(WorkoutStepField.durationValue, value.fromStep),
        uint32(WorkoutStepField.targetValue, value.count),
      ];
    case "other":
      return [
        type(codeOf(stepDurationTypes, value.durationType)),
        uint32(WorkoutStepField.durationValue, value.durationValue),
        uint32(WorkoutStepField.targetValue, value.targetValue),
      ];
  }
}

function stepFields(value: FitWorkoutStep, index: number): EncodedField[] {
  const fields: Field[] = [
    { number: WorkoutStepField.messageIndex, type: "uint16", value: index },
    value.name === undefined
      ? undefined
      : { number: WorkoutStepField.name, type: "string", value: value.name },
    ...durationFields(value.duration),
  ];
  if (value.duration.type !== "repeat" && value.duration.type !== "other") {
    const primary = targetFields(value.target);
    fields.push(
      { number: WorkoutStepField.targetType, type: "enum", value: primary.type },
      uint32(WorkoutStepField.targetValue, primary.value),
      uint32(WorkoutStepField.customTargetValueLow, primary.low),
      uint32(WorkoutStepField.customTargetValueHigh, primary.high),
    );
    if (value.secondaryTarget !== undefined) {
      const secondary = targetFields(value.secondaryTarget);
      fields.push(
        { number: WorkoutStepField.secondaryTargetType, type: "enum", value: secondary.type },
        uint32(WorkoutStepField.secondaryTargetValue, secondary.value),
        uint32(WorkoutStepField.secondaryCustomTargetValueLow, secondary.low),
        uint32(WorkoutStepField.secondaryCustomTargetValueHigh, secondary.high),
      );
    }
  }
  fields.push(
    value.intensity === undefined
      ? undefined
      : {
          number: WorkoutStepField.intensity,
          type: "enum",
          value: codeOf(intensities, value.intensity),
        },
    value.notes === undefined
      ? undefined
      : { number: WorkoutStepField.notes, type: "string", value: value.notes },
    value.equipment === undefined
      ? undefined
      : {
          number: WorkoutStepField.equipment,
          type: "enum",
          value: codeOf(workoutEquipment, value.equipment),
        },
  );
  return fields.filter((field) => field !== undefined);
}

function fitTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000) - fitEpochInUnixSeconds;
}

export function encodeFitWorkout(
  workout: FitWorkout,
  options: FitWorkoutEncodeOptions = {},
): Uint8Array {
  if (workout.steps.length === 0 || workout.steps.length > maxWorkoutSteps) {
    throw new RangeError(`A FIT workout holds 1 to ${maxWorkoutSteps} steps`);
  }
  const encoder = new FitEncoder();
  const fileIdFields: Field[] = [
    { number: FileIdField.type, type: "enum", value: workoutFileType },
    { number: FileIdField.manufacturer, type: "uint16", value: developmentManufacturer },
    { number: FileIdField.product, type: "uint16", value: 0 },
    options.timeCreated === undefined
      ? undefined
      : uint32(FileIdField.timeCreated, fitTimestamp(options.timeCreated)),
  ];
  encoder.message(
    MessageNumber.fileId,
    fileIdFields.filter((field) => field !== undefined),
  );
  const workoutFields: Field[] = [
    workout.name === undefined
      ? undefined
      : { number: WorkoutField.name, type: "string", value: workout.name },
    workout.sport === undefined
      ? undefined
      : { number: WorkoutField.sport, type: "enum", value: codeOf(sports, workout.sport) },
    workout.subSport === undefined
      ? undefined
      : { number: WorkoutField.subSport, type: "enum", value: codeOf(subSports, workout.subSport) },
    workout.poolLengthMeters === undefined
      ? undefined
      : {
          number: WorkoutField.poolLength,
          type: "uint16",
          value: rounded(workout.poolLengthMeters, Scale.distance),
        },
    workout.poolLengthMeters === undefined
      ? undefined
      : { number: WorkoutField.poolLengthUnit, type: "enum", value: metricUnits },
    { number: WorkoutField.numValidSteps, type: "uint16", value: workout.steps.length },
  ];
  encoder.message(
    MessageNumber.workout,
    workoutFields.filter((field) => field !== undefined),
  );
  workout.steps.forEach((value, index) => {
    encoder.message(MessageNumber.workoutStep, stepFields(value, index));
  });
  return encoder.file();
}
