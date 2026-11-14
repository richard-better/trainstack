import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { fitChecksum } from "../src/checksum.ts";
import {
  decodeFit,
  decodeFitWorkout,
  encodeFitWorkout,
  FitDecodeError,
  type FitDecodeErrorCode,
  type FitWorkout,
  maxWorkoutSteps,
  readFitFileId,
} from "../src/index.ts";
import { readFitMessages } from "../src/reader.ts";
import { FitWriter } from "./fit-writer.ts";
import { sampleRide } from "./goldens.ts";
import { readWorkoutFixture, type WorkoutFixture, workoutFixtures } from "./workout-fixtures.ts";

function assertFails(data: Uint8Array, code: FitDecodeErrorCode) {
  assert.throws(
    () => decodeFitWorkout(data),
    (error) => error instanceof FitDecodeError && error.code === code,
  );
}

const everything: FitWorkout = {
  name: "Every kind of step",
  sport: "running",
  subSport: "treadmill",
  poolLengthMeters: 25,
  steps: [
    {
      name: "Warm up",
      notes: "Easy does it",
      duration: { type: "time", seconds: 600.5 },
      target: {
        type: "heartRate",
        averaging: "instant",
        low: { unit: "bpm", value: 120 },
        high: { unit: "bpm", value: 135 },
      },
      intensity: "warmup",
    },
    {
      duration: { type: "distance", meters: 1000.25 },
      target: {
        type: "power",
        averaging: "3s",
        low: { unit: "watts", value: 250 },
        high: { unit: "watts", value: 270 },
      },
      secondaryTarget: { type: "cadence", low: 170, high: 180 },
      intensity: "active",
    },
    {
      duration: { type: "time", seconds: 60 },
      target: {
        type: "power",
        averaging: "lap",
        low: { unit: "percentFtp", value: 95 },
        high: { unit: "percentFtp", value: 105 },
      },
      intensity: "interval",
    },
    { duration: { type: "repeat", fromStep: 1, count: 4 } },
    {
      duration: { type: "open" },
      target: { type: "heartRate", averaging: "lap", zone: 2 },
      intensity: "recovery",
    },
    {
      duration: { type: "time", seconds: 120 },
      target: { type: "speed", averaging: "instant", low: 3.2, high: 3.512 },
    },
    {
      duration: { type: "time", seconds: 120 },
      target: { type: "speed", averaging: "lap", zone: 3 },
      secondaryTarget: {
        type: "heartRate",
        averaging: "instant",
        low: { unit: "percentMaxHeartRate", value: 70 },
        high: { unit: "percentMaxHeartRate", value: 80 },
      },
    },
    {
      duration: { type: "distance", meters: 100 },
      target: { type: "swimStroke", stroke: "butterfly" },
      equipment: "swimFins",
    },
    { duration: { type: "time", seconds: 30 }, target: { type: "cadence", zone: 1 } },
    {
      duration: {
        type: "other",
        durationType: "hrLessThan",
        durationValue: 230,
        targetValue: undefined,
      },
    },
    {
      duration: { type: "time", seconds: 30 },
      target: { type: "other", targetType: "grade", value: 0, low: 3, high: 5 },
      intensity: "cooldown",
    },
    {
      duration: {
        type: "other",
        durationType: "repeatUntilTime",
        durationValue: 4,
        targetValue: 900,
      },
      name: "Until 15 minutes",
    },
  ],
};

function withoutUndefined(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("encodeFitWorkout", () => {
  test("writes every duration and target that decodeFitWorkout reads, unchanged", () => {
    const decoded = decodeFitWorkout(encodeFitWorkout(everything));
    assert.deepEqual(
      withoutUndefined({ ...decoded, fileId: undefined }),
      withoutUndefined(everything),
    );
  });

  test("writes zero watts and zero bpm as zero, which FIT's offsets cannot say", () => {
    const decoded = decodeFitWorkout(
      encodeFitWorkout({
        sport: "cycling",
        steps: [
          {
            duration: { type: "time", seconds: 60 },
            target: {
              type: "power",
              averaging: "instant",
              low: { unit: "watts", value: 0 },
              high: { unit: "watts", value: 200 },
            },
            secondaryTarget: {
              type: "heartRate",
              averaging: "instant",
              low: { unit: "bpm", value: 0 },
              high: { unit: "bpm", value: 120 },
            },
          },
        ],
      }),
    );
    assert.deepEqual(decoded.steps[0]?.target, {
      type: "power",
      averaging: "instant",
      zone: undefined,
      low: { unit: "percentFtp", value: 0 },
      high: { unit: "watts", value: 200 },
    });
    assert.deepEqual(
      decoded.steps[0]?.secondaryTarget?.type === "heartRate" &&
        decoded.steps[0].secondaryTarget.low,
      { unit: "percentMaxHeartRate", value: 0 },
    );
  });

  test("marks the file as a workout from a development manufacturer, created when asked", () => {
    const timeCreated = new Date("2026-11-14T10:00:00Z");
    const fileId = readFitFileId(encodeFitWorkout(everything, { timeCreated }));
    assert.deepEqual(fileId, {
      type: "workout",
      manufacturer: 255,
      product: 0,
      serialNumber: undefined,
      timeCreated,
    });
  });

  test("writes a 14-byte header with its own checksum and a file checksum", () => {
    const bytes = encodeFitWorkout(everything);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(bytes[0], 14);
    assert.equal(bytes[1], 0x20);
    assert.equal(new TextDecoder().decode(bytes.subarray(8, 12)), ".FIT");
    assert.equal(view.getUint16(12, true), fitChecksum(bytes, 0, 12));
    assert.equal(view.getUint32(4, true), bytes.length - 16);
    assert.equal(view.getUint16(bytes.length - 2, true), fitChecksum(bytes, 0, bytes.length - 2));
  });

  test("defines each message layout once and reuses it", () => {
    const steps = Array.from({ length: 40 }, () => ({
      duration: { type: "time", seconds: 30 },
      target: {
        type: "power",
        averaging: "instant",
        low: { unit: "percentFtp", value: 100 },
        high: { unit: "percentFtp", value: 110 },
      },
    })) satisfies FitWorkout["steps"];
    const bytes = encodeFitWorkout({ name: "Same", sport: "cycling", steps });
    const definitions = countDefinitions(bytes);
    assert.equal(definitions, 3);
    assert.equal(readFitMessages(bytes).length, 42);
  });

  test("redefines local message types when more than sixteen layouts are in use", () => {
    const steps = Array.from({ length: 20 }, (_, index) => ({
      name: "x".repeat(index + 1),
      duration: { type: "time", seconds: 30 },
    })) satisfies FitWorkout["steps"];
    const decoded = decodeFitWorkout(encodeFitWorkout({ name: "Many", sport: "cycling", steps }));
    assert.deepEqual(
      decoded.steps.map((step) => step.name),
      steps.map((step) => step.name),
    );
  });

  test("cuts a long name at a character boundary within FIT's 255-byte strings", () => {
    const name = "é".repeat(200);
    const decoded = decodeFitWorkout(
      encodeFitWorkout({ name, sport: "cycling", steps: [{ duration: { type: "open" } }] }),
    );
    assert.equal(decoded.name, "é".repeat(127));
  });

  test("refuses values the field cannot hold, and workouts with no steps or too many", () => {
    assert.throws(
      () =>
        encodeFitWorkout({
          sport: "cycling",
          steps: [{ duration: { type: "time", seconds: 5_000_000 } }],
        }),
      RangeError,
    );
    assert.throws(() => encodeFitWorkout({ sport: "cycling", steps: [] }), RangeError);
    assert.throws(
      () =>
        encodeFitWorkout({
          sport: "cycling",
          steps: Array.from({ length: maxWorkoutSteps + 1 }, () => ({
            duration: { type: "open" } as const,
          })),
        }),
      RangeError,
    );
  });
});

function countDefinitions(bytes: Uint8Array): number {
  const sizes = new Map<number, number>();
  let position = 14;
  let definitions = 0;
  while (position < bytes.length - 2) {
    const header = bytes[position++]!;
    const local = header & 0x0f;
    if (header & 0x40) {
      definitions += 1;
      const fieldCount = bytes[position + 4]!;
      let size = 0;
      for (let field = 0; field < fieldCount; field++) size += bytes[position + 5 + field * 3 + 1]!;
      sizes.set(local, size);
      position += 5 + fieldCount * 3;
    } else {
      position += sizes.get(local)!;
    }
  }
  return definitions;
}

describe("decodeFitWorkout on files written the way other tools write them", () => {
  test("committed fixtures are what the fixture writer writes", () => {
    for (const [name, build] of Object.entries(workoutFixtures)) {
      assert.deepEqual(readWorkoutFixture(name as WorkoutFixture), build(), name);
    }
  });

  test("Garmin Connect: a zone, a custom speed range, repeat-until-steps and bpm", () => {
    const workout = decodeFitWorkout(readWorkoutFixture("garmin-connect-run-intervals.fit"));
    assert.equal(workout.fileId?.manufacturer, 1);
    assert.equal(workout.name, "5 x 1 km");
    assert.equal(workout.sport, "running");
    assert.equal(workout.subSport, "generic");
    assert.deepEqual(withoutUndefined(workout.steps), [
      {
        duration: { type: "time", seconds: 600 },
        target: { type: "heartRate", averaging: "instant", zone: 2 },
        intensity: "warmup",
      },
      {
        notes: "Controlled, even splits",
        duration: { type: "distance", meters: 1000 },
        target: { type: "speed", averaging: "instant", low: 3.846, high: 4.167 },
        intensity: "active",
      },
      { duration: { type: "time", seconds: 120 }, intensity: "recovery" },
      { duration: { type: "repeat", fromStep: 1, count: 5 } },
      {
        duration: { type: "time", seconds: 600 },
        target: {
          type: "heartRate",
          averaging: "instant",
          low: { unit: "bpm", value: 120 },
          high: { unit: "bpm", value: 140 },
        },
        intensity: "cooldown",
      },
    ]);
  });

  test("Garmin Connect: lap-button steps read as open durations", () => {
    const workout = decodeFitWorkout(readWorkoutFixture("garmin-connect-lap-button.fit"));
    assert.deepEqual(
      workout.steps.map((step) => step.duration),
      [{ type: "open" }, { type: "time", seconds: 1200 }, { type: "open" }],
    );
    assert.deepEqual(workout.steps[1]?.target, {
      type: "heartRate",
      averaging: "instant",
      zone: undefined,
      low: { unit: "percentMaxHeartRate", value: 80 },
      high: { unit: "percentMaxHeartRate", value: 87 },
    });
  });

  test("Garmin Connect: a step until heart rate drops keeps its type and raw value", () => {
    const workout = decodeFitWorkout(readWorkoutFixture("garmin-connect-hr-recovery.fit"));
    assert.deepEqual(workout.steps[1]?.duration, {
      type: "other",
      durationType: "hrLessThan",
      durationValue: 230,
      targetValue: undefined,
    });
  });

  test("Garmin Connect: power in watts past the 1000 offset, a power zone and cadence", () => {
    const workout = decodeFitWorkout(readWorkoutFixture("garmin-connect-bike-watts.fit"));
    assert.equal(workout.subSport, "indoorCycling");
    assert.deepEqual(workout.steps[0]?.target, {
      type: "power",
      averaging: "instant",
      zone: 2,
      low: undefined,
      high: undefined,
    });
    assert.deepEqual(withoutUndefined(workout.steps[1]), {
      duration: { type: "time", seconds: 720 },
      target: {
        type: "power",
        averaging: "instant",
        low: { unit: "watts", value: 230 },
        high: { unit: "watts", value: 245 },
      },
      secondaryTarget: { type: "cadence", low: 85, high: 95 },
      intensity: "active",
    });
  });

  test("Garmin Connect: a pool swim by distance with strokes, equipment and pool length", () => {
    const workout = decodeFitWorkout(readWorkoutFixture("garmin-connect-pool-swim.fit"));
    assert.equal(workout.sport, "swimming");
    assert.equal(workout.subSport, "lapSwimming");
    assert.equal(workout.poolLengthMeters, 25);
    assert.deepEqual(workout.steps[0]?.target, { type: "swimStroke", stroke: "freestyle" });
    assert.deepEqual(workout.steps[1]?.secondaryTarget, {
      type: "swimStroke",
      stroke: "freestyle",
    });
    assert.equal(workout.steps[1]?.equipment, "swimPullBuoy");
    assert.deepEqual(workout.steps[4]?.target, { type: "swimStroke", stroke: "backstroke" });
  });

  test("TrainingPeaks: percent-of-FTP ranges with step names and interval intensity", () => {
    const workout = decodeFitWorkout(readWorkoutFixture("trainingpeaks-bike.fit"));
    assert.equal(workout.steps[2]?.name, "Over");
    assert.equal(workout.steps[2]?.notes, "Stay seated");
    assert.equal(workout.steps[2]?.intensity, "interval");
    assert.deepEqual(workout.steps[2]?.target, {
      type: "power",
      averaging: "instant",
      zone: undefined,
      low: { unit: "percentFtp", value: 103 },
      high: { unit: "percentFtp", value: 107 },
    });
    assert.deepEqual(workout.steps[3], {
      name: "Over-unders",
      notes: undefined,
      duration: { type: "repeat", fromStep: 1, count: 3 },
      target: undefined,
      secondaryTarget: undefined,
      intensity: undefined,
      equipment: undefined,
    });
  });

  test("intervals.icu: nested repeats in big-endian messages", () => {
    const workout = decodeFitWorkout(readWorkoutFixture("intervals-icu-nested.fit"));
    assert.deepEqual(
      workout.steps.map((step) => step.duration),
      [
        { type: "time", seconds: 600 },
        { type: "time", seconds: 15 },
        { type: "time", seconds: 15 },
        { type: "repeat", fromStep: 1, count: 10 },
        { type: "time", seconds: 300 },
        { type: "repeat", fromStep: 1, count: 3 },
        { type: "distance", meters: 5000 },
      ],
    );
  });
});

describe("decodeFitWorkout on files that are not workouts", () => {
  test("refuses an activity file, which decodeFit reads", () => {
    assertFails(sampleRide(), "noWorkout");
    assert.equal(readFitFileId(sampleRide())?.type, "activity");
  });

  test("decodeFit refuses a workout file", () => {
    assert.throws(
      () => decodeFit(readWorkoutFixture("trainingpeaks-bike.fit")),
      (error) => error instanceof FitDecodeError && error.code === "noActivity",
    );
  });

  test("refuses a workout file with no steps", () => {
    const data = new FitWriter()
      .define(0, 0, [{ number: 0, type: "enum" }])
      .data(0, [5])
      .define(1, 26, [{ number: 8, type: "string", size: 8 }])
      .data(1, ["Empty"])
      .file();
    assertFails(data, "noWorkout");
  });

  test("refuses more steps than a workout can have before reading them all", () => {
    const writer = new FitWriter()
      .define(0, 0, [{ number: 0, type: "enum" }])
      .data(0, [5])
      .define(1, 27, [{ number: 1, type: "enum" }]);
    for (let index = 0; index <= maxWorkoutSteps; index++) writer.data(1, [5]);
    assertFails(writer.file(), "tooLarge");
  });

  test("refuses a step whose duration type is missing", () => {
    const data = new FitWriter()
      .define(0, 0, [{ number: 0, type: "enum" }])
      .data(0, [5])
      .define(1, 27, [{ number: 0, type: "string", size: 4 }])
      .data(1, ["abc"])
      .file();
    assertFails(data, "malformed");
  });
});

function random(seed: number) {
  let state = seed;
  return (below: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) % below;
  };
}

function withChecksum(bytes: Uint8Array): Uint8Array {
  const end = bytes.length - 2;
  const checksum = fitChecksum(bytes, 0, end);
  bytes[end] = checksum & 0xff;
  bytes[end + 1] = checksum >> 8;
  return bytes;
}

describe("decodeFitWorkout on crafted files", () => {
  const sources = Object.values(workoutFixtures).map((build) => build());

  test("every truncation fails with a FitDecodeError", () => {
    for (const source of sources) {
      for (let length = 0; length < source.length; length++) {
        assert.throws(
          () => decodeFitWorkout(source.subarray(0, length)),
          (error) => error instanceof FitDecodeError,
        );
      }
    }
  });

  test("random corruption behind a recomputed checksum decodes or fails with a FitDecodeError", () => {
    const next = random(64);
    for (let round = 0; round < 2_000; round++) {
      const source = sources[next(sources.length)]!;
      const bytes = source.slice();
      const flips = 1 + next(6);
      for (let flip = 0; flip < flips; flip++) {
        bytes[14 + next(bytes.length - 16)] = next(256);
      }
      try {
        decodeFitWorkout(withChecksum(bytes));
      } catch (error) {
        assert.ok(error instanceof FitDecodeError, String(error));
      }
    }
  });
});
