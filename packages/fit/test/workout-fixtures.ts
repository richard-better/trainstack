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

type Group = {
  global: number;
  fields: readonly (readonly [number, FieldSpec["type"]] | readonly [number, "string", number])[];
  rows: readonly (readonly (number | string | null)[])[];
};

function laidOut(
  groups: readonly Group[],
  { bigEndian = false, headerSize = 14 }: { bigEndian?: boolean; headerSize?: 12 | 14 } = {},
): Uint8Array {
  const writer = new FitWriter();
  for (const group of groups) {
    const fields = group.fields.map(([number, type, size]) =>
      size === undefined ? { number, type } : { number, type, size },
    );
    writer.define(0, group.global, fields, { bigEndian });
    for (const row of group.rows) writer.data(0, row);
  }
  return writer.file({ headerSize });
}

const minutes = (count: number) => count * 60_000;
const watts = (value: number) => value + 1000;
const bpm = (value: number) => value + 100;
const metres = (value: number) => value * 100;
const development = 255;
const invalid32 = 0xffffffff;

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
  "garmin-connect-lap-intervals.fit": () =>
    laidOut(
      [
        {
          global: 0,
          fields: [
            [0, "enum"],
            [1, "uint16"],
            [2, "uint16"],
            [4, "uint32"],
            [3, "uint32z"],
          ],
          rows: [[5, 1, 65534, fitTime("2026-10-12T06:40:00Z"), 1_677_000_123]],
        },
        {
          global: 49,
          fields: [
            [1, "uint8"],
            [0, "uint16"],
          ],
          rows: [[0, 2210]],
        },
        {
          global: 26,
          fields: [
            [8, "string", 28],
            [17, "string", 64],
            [4, "enum"],
            [11, "enum"],
            [5, "uint32z"],
            [6, "uint16"],
            [254, "uint16"],
          ],
          rows: [
            [
              "Threshold 4 x 5 min, on lap",
              "Warm up, then press lap to start each interval.",
              2,
              0,
              32,
              9,
              0,
            ],
          ],
        },
        {
          global: 27,
          fields: [
            [254, "uint16"],
            [7, "enum"],
            [3, "enum"],
            [4, "uint32"],
            [19, "enum"],
            [20, "uint32"],
            [1, "enum"],
            [2, "uint32"],
          ],
          rows: [
            [0, Intensity.warmup, Target.heartRate, 2, 255, 0, Duration.time, minutes(5)],
            [1, Intensity.warmup, Target.heartRate, 3, 255, 0, Duration.time, minutes(5)],
            [2, Intensity.warmup, Target.heartRate, 4, 255, 0, Duration.time, minutes(5)],
            [3, Intensity.warmup, Target.heartRate, 1, 255, 0, Duration.time, minutes(2)],
            [4, Intensity.active, Target.heartRate, 2, 255, 0, Duration.open, invalid32],
            [5, Intensity.active, Target.heartRate, 4, 255, 0, Duration.time, minutes(5)],
          ],
        },
        {
          global: 27,
          fields: [
            [254, "uint16"],
            [7, "enum"],
            [3, "enum"],
            [4, "uint32"],
            [19, "enum"],
            [20, "uint32"],
            [1, "enum"],
            [8, "string", 40],
          ],
          rows: [
            [
              6,
              Intensity.recovery,
              Target.heartRate,
              2,
              255,
              0,
              Duration.open,
              "Recover as long as you need, then lap.",
            ],
          ],
        },
        {
          global: 27,
          fields: [
            [1, "enum"],
            [4, "uint32"],
            [254, "uint16"],
            [2, "uint32"],
          ],
          rows: [[Duration.repeatUntilStepsCmplt, 4, 7, 5]],
        },
        {
          global: 27,
          fields: [
            [254, "uint16"],
            [7, "enum"],
            [3, "enum"],
            [4, "uint32"],
            [19, "enum"],
            [20, "uint32"],
            [1, "enum"],
          ],
          rows: [[8, Intensity.active, Target.heartRate, 2, 255, 0, Duration.open]],
        },
      ],
      { bigEndian: true },
    ),
  "trainerroad-lap.fit": () => {
    const stepFields = (notes: number, withValue: boolean): Group["fields"] => [
      [254, "uint16"],
      [7, "enum"],
      [1, "enum"],
      ...(withValue ? ([[2, "uint32"]] as const) : []),
      [3, "enum"],
      [4, "uint32"],
      [6, "uint32"],
      [5, "uint32"],
      [8, "string", notes],
    ];
    const step = (
      index: number,
      intensity: number,
      duration: number,
      value: number | undefined,
      low: number,
      high: number,
      notes: string,
    ): Group => ({
      global: 27,
      fields: stepFields(notes.length + 1, value !== undefined),
      rows: [
        [
          index,
          intensity,
          duration,
          ...(value !== undefined ? [value] : []),
          10,
          0,
          watts(high),
          watts(low),
          notes,
        ],
      ],
    });
    return laidOut([
      {
        global: 0,
        fields: [
          [0, "enum"],
          [1, "uint16"],
          [2, "uint16"],
          [3, "uint32z"],
          [4, "uint32"],
        ],
        rows: [[5, 281, 1, 812_345, fitTime("2026-09-20T17:00:00Z")]],
      },
      {
        global: 26,
        fields: [
          [6, "uint16"],
          [4, "enum"],
          [8, "string", 5],
          [5, "uint32z"],
        ],
        rows: [[5, 2, "Pine", 2048]],
      },
      step(0, Intensity.warmup, Duration.time, minutes(10), 150, 195, "Ten minutes to warm up."),
      step(1, Intensity.rest, Duration.open, undefined, 1, 150, "Press lap when ready to start."),
      step(2, Intensity.active, Duration.time, minutes(40), 195, 225, "Forty minutes steady."),
      step(3, Intensity.cooldown, Duration.time, minutes(5), 1, 150, "Five minutes easy."),
      step(4, Intensity.cooldown, Duration.open, invalid32, 1, 150, "Press lap to finish."),
    ]);
  },
  "trainingpeaks-lap-bike.fit": () => {
    const stepFields = (name: number): Group["fields"] => [
      [0, "string", name],
      [2, "uint32"],
      [3, "enum"],
      [4, "uint32"],
      [5, "uint32"],
      [6, "uint32"],
      [7, "enum"],
      [19, "enum"],
      [20, "uint32"],
      [21, "uint32"],
      [22, "uint32"],
      [254, "uint16"],
      [1, "enum"],
    ];
    const none = [255, invalid32, invalid32, invalid32] as const;
    return laidOut([
      {
        global: 0,
        fields: [
          [0, "enum"],
          [1, "uint16"],
          [2, "uint16"],
          [3, "uint32z"],
          [4, "uint32"],
        ],
        rows: [[5, 28, 0, 2_301_234_567, fitTime("2026-08-03T05:30:00Z")]],
      },
      { global: 49, fields: [[0, "uint16"]], rows: [[0]] },
      {
        global: 27,
        fields: stepFields(8),
        rows: [
          [
            "Warm up",
            invalid32,
            Target.power,
            0,
            watts(110),
            watts(130),
            Intensity.warmup,
            ...none,
            0,
            Duration.open,
          ],
          [
            "Hard",
            minutes(6),
            Target.power,
            0,
            watts(240),
            watts(260),
            Intensity.active,
            Target.cadence,
            0,
            95,
            105,
            1,
            Duration.time,
          ],
          [
            "Easy",
            minutes(3),
            Target.power,
            0,
            watts(120),
            watts(140),
            Intensity.rest,
            ...none,
            2,
            Duration.time,
          ],
        ],
      },
      {
        global: 27,
        fields: stepFields(9),
        rows: [
          ["", 1, 255, 4, invalid32, invalid32, 255, ...none, 3, Duration.repeatUntilStepsCmplt],
        ],
      },
      {
        global: 27,
        fields: stepFields(10),
        rows: [
          [
            "Cool Down",
            minutes(10),
            Target.power,
            0,
            watts(110),
            watts(130),
            Intensity.cooldown,
            ...none,
            4,
            Duration.time,
          ],
          [
            "",
            invalid32,
            255,
            invalid32,
            invalid32,
            invalid32,
            Intensity.cooldown,
            ...none,
            5,
            Duration.open,
          ],
        ],
      },
      {
        global: 26,
        fields: [
          [4, "enum"],
          [8, "string", 12],
          [6, "uint16"],
        ],
        rows: [[2, "Lap to cool", 6]],
      },
    ]);
  },
  "trainingpeaks-lap-heart-rate.fit": () => {
    const stepFields = (name: number): Group["fields"] => [
      [0, "string", name],
      [2, "uint32"],
      [3, "enum"],
      [4, "uint32"],
      [5, "uint32"],
      [6, "uint32"],
      [7, "enum"],
      [254, "uint16"],
      [1, "enum"],
    ];
    return laidOut([
      {
        global: 0,
        fields: [
          [0, "enum"],
          [1, "uint16"],
          [2, "uint16"],
          [3, "uint32z"],
          [4, "uint32"],
        ],
        rows: [[5, 28, 0, 2_023_176_670, fitTime("2026-08-04T05:30:00Z")]],
      },
      { global: 49, fields: [[0, "uint16"]], rows: [[0]] },
      {
        global: 27,
        fields: stepFields(7),
        rows: [
          [
            "Active",
            minutes(10),
            Target.heartRate,
            0,
            bpm(140),
            bpm(160),
            Intensity.active,
            0,
            Duration.time,
          ],
        ],
      },
      {
        global: 27,
        fields: stepFields(14),
        rows: [
          [
            "",
            invalid32,
            255,
            invalid32,
            invalid32,
            invalid32,
            Intensity.cooldown,
            1,
            Duration.open,
          ],
        ],
      },
      {
        global: 26,
        fields: [
          [4, "enum"],
          [8, "string", 21],
          [6, "uint16"],
        ],
        rows: [[2, "Heart rate, then lap", 2]],
      },
    ]);
  },
  "zwo-converter-bike-lap.fit": () =>
    laidOut(
      [
        {
          global: 0,
          fields: [
            [0, "enum"],
            [1, "uint16"],
            [2, "uint16"],
            [3, "uint32z"],
            [4, "uint32"],
          ],
          rows: [[5, 1, 0, 305_419_896, fitTime("2026-09-01T12:00:00Z")]],
        },
        {
          global: 26,
          fields: [
            [4, "enum"],
            [5, "uint32z"],
            [6, "uint16"],
          ],
          rows: [[2, 32, 5]],
        },
        {
          global: 27,
          fields: [
            [254, "uint16"],
            [1, "enum"],
            [2, "uint32"],
            [3, "enum"],
            [4, "uint32"],
            [5, "uint32"],
            [6, "uint32"],
            [7, "enum"],
          ],
          rows: [
            [0, Duration.open, 0, Target.power, 0, watts(114), watts(126), Intensity.warmup],
            [
              1,
              Duration.time,
              minutes(2),
              Target.power,
              0,
              watts(251),
              watts(277),
              Intensity.active,
            ],
            [2, Duration.time, minutes(2), Target.power, 0, watts(125), watts(139), Intensity.rest],
            [
              3,
              Duration.time,
              minutes(2),
              Target.power,
              0,
              watts(251),
              watts(277),
              Intensity.active,
            ],
            [
              4,
              Duration.time,
              minutes(10),
              Target.power,
              0,
              watts(125),
              watts(164),
              Intensity.cooldown,
            ],
          ],
        },
      ],
      { headerSize: 12 },
    ),
  "zwo-converter-run-lap.fit": () =>
    laidOut(
      [
        {
          global: 0,
          fields: [
            [0, "enum"],
            [1, "uint16"],
            [2, "uint16"],
            [3, "uint32z"],
            [4, "uint32"],
          ],
          rows: [[5, 1, 0, 305_419_896, fitTime("2026-09-02T12:00:00Z")]],
        },
        {
          global: 26,
          fields: [
            [4, "enum"],
            [5, "uint32z"],
            [6, "uint16"],
          ],
          rows: [[1, 32, 5]],
        },
        {
          global: 27,
          fields: [
            [254, "uint16"],
            [1, "enum"],
            [2, "uint32"],
            [3, "enum"],
            [4, "uint32"],
            [7, "enum"],
          ],
          rows: [
            [0, Duration.open, 0, Target.heartRate, 1, Intensity.warmup],
            [1, Duration.time, minutes(20), Target.heartRate, 2, Intensity.active],
            [2, Duration.time, 20_000, Target.heartRate, 5, Intensity.active],
            [3, Duration.time, minutes(1), Target.heartRate, 2, Intensity.rest],
            [4, Duration.time, minutes(5), Target.heartRate, 2, Intensity.cooldown],
          ],
        },
      ],
      { headerSize: 12 },
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
