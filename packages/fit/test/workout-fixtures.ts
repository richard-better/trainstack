import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { type FieldSpec, FitWriter, fitTime } from "./fit-writer.ts";

const fixtures = new URL("./fixtures/workouts/", import.meta.url);

const Duration = {
  time: 0,
  distance: 1,
  hrLessThan: 2,
  open: 5,
  repeatUntilStepsCmplt: 6,
} as const;

const Target = {
  speed: 0,
  heartRate: 1,
  open: 2,
  cadence: 3,
  power: 4,
  swimStroke: 11,
} as const;

const Intensity = { active: 0, rest: 1, warmup: 2, cooldown: 3, recovery: 4, interval: 5 } as const;

type StepValues = {
  name?: string;
  durationType: number;
  durationValue?: number;
  targetType?: number;
  targetValue?: number;
  low?: number;
  high?: number;
  intensity?: number;
  notes?: string;
  equipment?: number;
  secondaryTargetType?: number;
  secondaryTargetValue?: number;
  secondaryLow?: number;
  secondaryHigh?: number;
};

const garminStepFields: FieldSpec[] = [
  { number: 254, type: "uint16" },
  { number: 0, type: "string", size: 16 },
  { number: 1, type: "enum" },
  { number: 2, type: "uint32" },
  { number: 3, type: "enum" },
  { number: 4, type: "uint32" },
  { number: 5, type: "uint32" },
  { number: 6, type: "uint32" },
  { number: 7, type: "enum" },
  { number: 8, type: "string", size: 51 },
  { number: 9, type: "enum" },
  { number: 10, type: "uint16" },
  { number: 19, type: "enum" },
  { number: 20, type: "uint32" },
  { number: 21, type: "uint32" },
  { number: 22, type: "uint32" },
];

function garminStep(index: number, step: StepValues) {
  return [
    index,
    step.name ?? null,
    step.durationType,
    step.durationValue ?? null,
    step.targetType ?? null,
    step.targetValue ?? null,
    step.low ?? null,
    step.high ?? null,
    step.intensity ?? null,
    step.notes ?? null,
    step.equipment ?? null,
    null,
    step.secondaryTargetType ?? null,
    step.secondaryTargetValue ?? null,
    step.secondaryLow ?? null,
    step.secondaryHigh ?? null,
  ];
}

type Workout = { name: string; sport: number; subSport?: number; poolLength?: number };

function garminConnect(workout: Workout, steps: StepValues[]): Uint8Array {
  const writer = new FitWriter()
    .define(0, 0, [
      { number: 3, type: "uint32z" },
      { number: 4, type: "uint32" },
      { number: 1, type: "uint16" },
      { number: 2, type: "uint16" },
      { number: 0, type: "enum" },
    ])
    .data(0, [3_996_204_221, fitTime("2026-10-02T07:15:00Z"), 1, 65534, 5])
    .define(1, 26, [
      { number: 5, type: "uint32z" },
      { number: 6, type: "uint16" },
      { number: 8, type: "string", size: 40 },
      { number: 4, type: "enum" },
      { number: 11, type: "enum" },
      { number: 14, type: "uint16" },
      { number: 15, type: "enum" },
    ])
    .data(1, [
      32,
      steps.length,
      workout.name,
      workout.sport,
      workout.subSport ?? 0,
      workout.poolLength ?? null,
      workout.poolLength === undefined ? null : 0,
    ])
    .define(2, 27, garminStepFields);
  steps.forEach((step, index) => writer.data(2, garminStep(index, step)));
  return writer.file();
}

const webStepFields: FieldSpec[] = [
  { number: 254, type: "uint16" },
  { number: 0, type: "string", size: 32 },
  { number: 1, type: "enum" },
  { number: 2, type: "uint32" },
  { number: 3, type: "enum" },
  { number: 4, type: "uint32" },
  { number: 5, type: "uint32" },
  { number: 6, type: "uint32" },
  { number: 7, type: "enum" },
  { number: 8, type: "string", size: 64 },
];

const webSecondaryFields: FieldSpec[] = [
  ...webStepFields,
  { number: 19, type: "enum" },
  { number: 20, type: "uint32" },
  { number: 21, type: "uint32" },
  { number: 22, type: "uint32" },
];

function webStep(index: number, step: StepValues) {
  return [
    index,
    step.name ?? "",
    step.durationType,
    step.durationValue ?? 0,
    step.targetType ?? Target.open,
    step.targetValue ?? 0,
    step.low ?? null,
    step.high ?? null,
    step.intensity ?? null,
    step.notes ?? "",
  ];
}

function webTool(
  manufacturer: number,
  product: number,
  workout: Workout,
  steps: StepValues[],
  { bigEndian = false }: { bigEndian?: boolean } = {},
): Uint8Array {
  const writer = new FitWriter()
    .define(
      0,
      0,
      [
        { number: 0, type: "enum" },
        { number: 1, type: "uint16" },
        { number: 2, type: "uint16" },
        { number: 4, type: "uint32" },
      ],
      { bigEndian },
    )
    .data(0, [5, manufacturer, product, fitTime("2026-11-01T18:30:00Z")])
    .define(
      1,
      26,
      [
        { number: 8, type: "string", size: 64 },
        { number: 4, type: "enum" },
        { number: 6, type: "uint16" },
      ],
      { bigEndian },
    )
    .data(1, [workout.name, workout.sport, steps.length])
    .define(2, 27, webStepFields, { bigEndian })
    .define(3, 27, webSecondaryFields, { bigEndian });
  steps.forEach((step, index) => {
    if (step.secondaryTargetType === undefined) {
      writer.data(2, webStep(index, step));
      return;
    }
    writer.data(3, [
      ...webStep(index, step),
      step.secondaryTargetType,
      step.secondaryTargetValue ?? 0,
      step.secondaryLow ?? null,
      step.secondaryHigh ?? null,
    ]);
  });
  return writer.file();
}

const minutes = (count: number) => count * 60_000;
const watts = (value: number) => value + 1000;
const bpm = (value: number) => value + 100;
const metres = (value: number) => value * 100;
const development = 255;

export const workoutFixtures = {
  "garmin-connect-run-intervals.fit": () =>
    garminConnect({ name: "5 x 1 km", sport: 1 }, [
      {
        durationType: Duration.time,
        durationValue: minutes(10),
        targetType: Target.heartRate,
        targetValue: 2,
        intensity: Intensity.warmup,
      },
      {
        durationType: Duration.distance,
        durationValue: metres(1000),
        targetType: Target.speed,
        targetValue: 0,
        low: 3846,
        high: 4167,
        intensity: Intensity.active,
        notes: "Controlled, even splits",
      },
      {
        durationType: Duration.time,
        durationValue: minutes(2),
        targetType: Target.open,
        intensity: Intensity.recovery,
      },
      {
        durationType: Duration.repeatUntilStepsCmplt,
        durationValue: 1,
        targetValue: 5,
      },
      {
        durationType: Duration.time,
        durationValue: minutes(10),
        targetType: Target.heartRate,
        targetValue: 0,
        low: bpm(120),
        high: bpm(140),
        intensity: Intensity.cooldown,
      },
    ]),
  "garmin-connect-lap-button.fit": () =>
    garminConnect({ name: "Tempo run", sport: 1 }, [
      {
        durationType: Duration.open,
        targetType: Target.open,
        intensity: Intensity.warmup,
        notes: "Press lap when warm",
      },
      {
        durationType: Duration.time,
        durationValue: minutes(20),
        targetType: Target.heartRate,
        targetValue: 0,
        low: 80,
        high: 87,
        intensity: Intensity.active,
      },
      { durationType: Duration.open, targetType: Target.open, intensity: Intensity.cooldown },
    ]),
  "garmin-connect-hr-recovery.fit": () =>
    garminConnect({ name: "Hill repeats", sport: 1 }, [
      {
        durationType: Duration.time,
        durationValue: minutes(1),
        targetType: Target.open,
        intensity: Intensity.active,
      },
      {
        durationType: Duration.hrLessThan,
        durationValue: bpm(130),
        targetType: Target.open,
        intensity: Intensity.recovery,
      },
      { durationType: Duration.repeatUntilStepsCmplt, durationValue: 0, targetValue: 6 },
    ]),
  "garmin-connect-bike-watts.fit": () =>
    garminConnect({ name: "Sweet spot 3 x 12", sport: 2, subSport: 6 }, [
      {
        durationType: Duration.time,
        durationValue: minutes(10),
        targetType: Target.power,
        targetValue: 2,
        intensity: Intensity.warmup,
      },
      {
        durationType: Duration.time,
        durationValue: minutes(12),
        targetType: Target.power,
        targetValue: 0,
        low: watts(230),
        high: watts(245),
        intensity: Intensity.active,
        secondaryTargetType: Target.cadence,
        secondaryTargetValue: 0,
        secondaryLow: 85,
        secondaryHigh: 95,
      },
      {
        durationType: Duration.time,
        durationValue: minutes(4),
        targetType: Target.power,
        targetValue: 0,
        low: watts(120),
        high: watts(150),
        intensity: Intensity.recovery,
      },
      { durationType: Duration.repeatUntilStepsCmplt, durationValue: 1, targetValue: 3 },
      {
        durationType: Duration.time,
        durationValue: minutes(8),
        targetType: Target.open,
        intensity: Intensity.cooldown,
      },
    ]),
  "garmin-connect-pool-swim.fit": () =>
    garminConnect({ name: "CSS 8 x 100", sport: 5, subSport: 17, poolLength: metres(25) }, [
      {
        durationType: Duration.distance,
        durationValue: metres(400),
        targetType: Target.swimStroke,
        targetValue: 0,
        intensity: Intensity.warmup,
      },
      {
        durationType: Duration.distance,
        durationValue: metres(100),
        targetType: Target.speed,
        targetValue: 0,
        low: 1176,
        high: 1250,
        intensity: Intensity.active,
        equipment: 4,
        secondaryTargetType: Target.swimStroke,
        secondaryTargetValue: 0,
      },
      {
        durationType: Duration.time,
        durationValue: 20_000,
        targetType: Target.open,
        intensity: Intensity.rest,
      },
      { durationType: Duration.repeatUntilStepsCmplt, durationValue: 1, targetValue: 8 },
      {
        durationType: Duration.distance,
        durationValue: metres(200),
        targetType: Target.swimStroke,
        targetValue: 1,
        intensity: Intensity.cooldown,
      },
    ]),
  "trainingpeaks-bike.fit": () =>
    webTool(development, 0, { name: "Over-unders 3 x 9", sport: 2 }, [
      {
        name: "Warm up",
        durationType: Duration.time,
        durationValue: minutes(15),
        targetType: Target.power,
        low: 50,
        high: 65,
        intensity: Intensity.warmup,
      },
      {
        name: "Under",
        durationType: Duration.time,
        durationValue: minutes(2),
        targetType: Target.power,
        low: 88,
        high: 92,
        intensity: Intensity.interval,
      },
      {
        name: "Over",
        durationType: Duration.time,
        durationValue: minutes(1),
        targetType: Target.power,
        low: 103,
        high: 107,
        intensity: Intensity.interval,
        notes: "Stay seated",
      },
      {
        name: "Over-unders",
        durationType: Duration.repeatUntilStepsCmplt,
        durationValue: 1,
        targetValue: 3,
      },
      {
        name: "Recover",
        durationType: Duration.time,
        durationValue: minutes(5),
        targetType: Target.power,
        low: 50,
        high: 50,
        intensity: Intensity.rest,
      },
      {
        name: "Cool down",
        durationType: Duration.time,
        durationValue: minutes(10),
        targetType: Target.power,
        low: 40,
        high: 55,
        intensity: Intensity.cooldown,
      },
    ]),
  "trainingpeaks-run-heart-rate.fit": () =>
    webTool(development, 0, { name: "Aerobic run", sport: 1 }, [
      {
        name: "Warm up",
        durationType: Duration.time,
        durationValue: minutes(10),
        targetType: Target.heartRate,
        low: 60,
        high: 70,
        intensity: Intensity.warmup,
      },
      {
        name: "Steady",
        durationType: Duration.time,
        durationValue: minutes(40),
        targetType: Target.heartRate,
        low: bpm(138),
        high: bpm(148),
        intensity: Intensity.active,
      },
    ]),
  "intervals-icu-nested.fit": () =>
    webTool(
      development,
      0,
      { name: "Micro bursts", sport: 2 },
      [
        {
          name: "Warmup",
          durationType: Duration.time,
          durationValue: minutes(10),
          targetType: Target.power,
          low: 55,
          high: 55,
          intensity: Intensity.warmup,
        },
        {
          name: "On",
          durationType: Duration.time,
          durationValue: 15_000,
          targetType: Target.power,
          low: watts(400),
          high: watts(420),
          intensity: Intensity.active,
          secondaryTargetType: Target.cadence,
          secondaryLow: 100,
          secondaryHigh: 110,
        },
        {
          name: "Off",
          durationType: Duration.time,
          durationValue: 15_000,
          targetType: Target.power,
          low: watts(150),
          high: watts(150),
          intensity: Intensity.recovery,
        },
        { durationType: Duration.repeatUntilStepsCmplt, durationValue: 1, targetValue: 10 },
        {
          name: "Between sets",
          durationType: Duration.time,
          durationValue: minutes(5),
          targetType: Target.power,
          low: 50,
          high: 50,
          intensity: Intensity.rest,
        },
        { durationType: Duration.repeatUntilStepsCmplt, durationValue: 1, targetValue: 3 },
        {
          name: "Cooldown",
          durationType: Duration.distance,
          durationValue: metres(5000),
          targetType: Target.open,
          intensity: Intensity.cooldown,
        },
      ],
      { bigEndian: true },
    ),
} satisfies Record<string, () => Uint8Array>;

export type WorkoutFixture = keyof typeof workoutFixtures;

export function readWorkoutFixture(name: WorkoutFixture): Uint8Array {
  return new Uint8Array(readFileSync(new URL(name, fixtures)));
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes("--write")) {
  for (const [name, build] of Object.entries(workoutFixtures)) {
    writeFileSync(new URL(name, fixtures), build());
  }
}
