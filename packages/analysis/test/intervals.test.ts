import assert from "node:assert/strict";
import { test } from "node:test";

import type { Workout } from "@trainstack/workout";

import { decodeFit } from "@trainstack/fit";

import { trace } from "../../fit/test/goldens.ts";
import { type AnalysisActivity, intervalCompliance } from "../src/index.ts";

const start = new Date("2026-06-01T06:00:00Z");

const watts = (seconds: number, value: number, kind: "constant" | "ftp" = "constant") => ({
  type: "step" as const,
  duration: { type: "time" as const, seconds },
  target:
    kind === "ftp"
      ? {
          type: "power" as const,
          unit: "ftp" as const,
          level: { kind: "constant" as const, value },
        }
      : {
          type: "power" as const,
          unit: "watts" as const,
          level: { kind: "constant" as const, value },
        },
});

const ride = (steps: Workout["steps"]): Workout => ({ name: "Ride", sport: "cycling", steps });

function activity(
  power: (second: number) => number,
  seconds: number,
  extra: Partial<AnalysisActivity> = {},
): AnalysisActivity {
  return {
    summary: { startTime: start, sport: "cycling", subSport: undefined, elapsedSeconds: seconds },
    records: Array.from({ length: seconds + 1 }, (_, second) => ({
      elapsedSeconds: second,
      power: power(second),
    })),
    ...extra,
  };
}

const share = (result: ReturnType<typeof intervalCompliance>) =>
  result && result.secondsInTarget / result.secondsWithData;

test("riding each step at its target is all in target", () => {
  const result = intervalCompliance(
    activity((second) => (second < 600 ? 200 : 300), 900),
    ride([watts(600, 200), watts(300, 300)]),
    {},
  );
  assert.equal(result?.alignedBy, "time");
  assert.ok(share(result)! > 0.99, `${share(result)}`);
  assert.deepEqual(
    result?.steps.map(({ index, metric, low, high }) => [index, metric, low, high]),
    [
      [0, "power", 190, 210],
      [1, "power", 285, 315],
    ],
  );
});

test("a step ridden below its target counts against it, and each step says so", () => {
  const result = intervalCompliance(
    activity((second) => (second < 600 ? 200 : 250), 900),
    ride([watts(600, 200), watts(300, 300)]),
    {},
  );
  assert.ok(Math.abs(share(result)! - 600 / 900) < 0.01, `${share(result)}`);
  assert.equal(result?.steps[1]?.secondsInTarget, 0);
  assert.ok(Math.abs(result!.steps[1]!.average! - 250) < 1);
});

test("a pause does not count, and the steps carry on in moving time after it", () => {
  const pausedFrom = 300;
  const pausedTo = 500;
  const result = intervalCompliance(
    activity((second) => (second < pausedTo + 300 ? 200 : 300), pausedTo + 600, {
      events: [
        {
          time: new Date(start.getTime() + pausedFrom * 1000),
          event: "timer",
          type: "stopAll",
        },
        { time: new Date(start.getTime() + pausedTo * 1000), event: "timer", type: "start" },
      ],
    }),
    ride([watts(600, 200), watts(300, 300)]),
    {},
  );
  assert.ok(share(result)! > 0.98, `${share(result)}`);
});

test("laps that match the steps place them, so a warm-up before the workout does no harm", () => {
  const warmUp = 300;
  const power = (second: number) => (second < warmUp ? 120 : second < warmUp + 600 ? 200 : 300);
  const laps = [
    { startTime: new Date(start.getTime()), elapsedSeconds: warmUp + 600 },
    { startTime: new Date(start.getTime() + (warmUp + 600) * 1000), elapsedSeconds: 300 },
  ];
  const workout = ride([watts(600, 200), watts(300, 300)]);
  const byTime = intervalCompliance(activity(power, warmUp + 900), workout, {});
  assert.equal(byTime?.alignedBy, "time");
  assert.ok(share(byTime)! < 0.8);
  const byLaps = intervalCompliance(
    activity(power, warmUp + 900, {
      laps: [
        { startTime: new Date(start.getTime() + warmUp * 1000), elapsedSeconds: 600 },
        laps[1]!,
      ],
    }),
    workout,
    {},
  );
  assert.equal(byLaps?.alignedBy, "laps");
  assert.ok(share(byLaps)! > 0.99, `${share(byLaps)}`);
});

test("a share of FTP needs the day's FTP, and a workout without targets has nothing to score", () => {
  const steady = activity(() => 200, 600);
  assert.equal(intervalCompliance(steady, ride([watts(600, 0.8, "ftp")]), {}), null);
  assert.ok(
    share(intervalCompliance(steady, ride([watts(600, 0.8, "ftp")]), { ftp: 250 }))! > 0.99,
  );
  assert.equal(
    intervalCompliance(
      steady,
      ride([{ type: "step", duration: { type: "time", seconds: 600 } }]),
      {},
    ),
    null,
  );
});

test("a run's distance steps follow the distance covered, against a speed target", () => {
  const run: Workout = {
    name: "Run",
    sport: "running",
    steps: [
      {
        type: "step",
        duration: { type: "distance", meters: 1000 },
        target: { type: "pace", unit: "metersPerSecond", level: { kind: "constant", value: 4 } },
      },
      {
        type: "step",
        duration: { type: "distance", meters: 1000 },
        target: { type: "pace", unit: "metersPerSecond", level: { kind: "constant", value: 3 } },
      },
    ],
  };
  const speedAt = (second: number) => (second < 250 ? 4 : 3);
  let covered = 0;
  const records = Array.from({ length: 584 }, (_, second) => {
    const record = {
      elapsedSeconds: second,
      speedMetresPerSecond: speedAt(second),
      distanceMetres: covered,
    };
    covered += speedAt(second);
    return record;
  });
  const result = intervalCompliance(
    {
      summary: { startTime: start, sport: "running", subSport: undefined, elapsedSeconds: 583 },
      records,
    },
    run,
    {},
  );
  assert.ok(share(result)! > 0.95, `${share(result)}`);
  assert.deepEqual(
    result?.steps.map(({ metric }) => metric),
    ["speed", "speed"],
  );
});

test("a ramp stopped halfway is held against the ramp as planned, not squeezed into what was ridden", () => {
  const ramp: Workout = ride([
    {
      type: "step",
      duration: { type: "time", seconds: 600 },
      target: { type: "power", unit: "watts", level: { kind: "ramp", from: 100, to: 200 } },
    },
  ]);
  const result = intervalCompliance(
    activity((second) => 100 + (100 * second) / 599, 299),
    ramp,
    {},
  );
  assert.ok(share(result)! > 0.95, `${share(result)}`);
});

test("a ramp placed by its lap runs over that lap", () => {
  const ramp: Workout = ride([
    {
      type: "step",
      duration: { type: "time", seconds: 600 },
      target: { type: "power", unit: "watts", level: { kind: "ramp", from: 100, to: 200 } },
    },
    watts(300, 150),
  ]);
  const result = intervalCompliance(
    activity((second) => (second < 560 ? 100 + (100 * second) / 559 : 150), 860, {
      laps: [
        { startTime: start, elapsedSeconds: 560 },
        { startTime: new Date(start.getTime() + 560_000), elapsedSeconds: 300 },
      ],
    }),
    ramp,
    {},
  );
  assert.equal(result?.alignedBy, "laps");
  assert.ok(share(result)! > 0.95, `${share(result)}`);
});

const untilLap = (value: number) =>
  ({
    type: "step",
    duration: { type: "open" },
    target: { type: "power", unit: "watts", level: { kind: "constant", value } },
  }) as unknown as Workout["steps"][number];

test("a step whose length is not known in advance stops the layout by time, and says which steps it could not place", () => {
  const result = intervalCompliance(
    activity((second) => (second < 300 ? 200 : 250), 900),
    ride([watts(300, 200), untilLap(250), watts(300, 300)]),
    {},
  );
  assert.equal(result?.alignedBy, "time");
  assert.deepEqual(
    result?.steps.map(({ index, placed, secondsWithData }) => [index, placed, secondsWithData > 0]),
    [
      [0, true, true],
      [1, false, false],
      [2, false, false],
    ],
  );
  assert.ok(share(result)! > 0.95);
});

test("laps place a step whose length is not known in advance, and its target is scored", () => {
  const result = intervalCompliance(
    activity((second) => (second < 300 ? 200 : 250), 700, {
      laps: [
        { startTime: start, elapsedSeconds: 300 },
        { startTime: new Date(start.getTime() + 300_000), elapsedSeconds: 400 },
      ],
    }),
    ride([watts(300, 200), untilLap(250)]),
    {},
  );
  assert.equal(result?.alignedBy, "laps");
  assert.ok(result?.steps.every(({ placed }) => placed));
  assert.ok(share(result)! > 0.95);
});

test("a workout of one step that lasts until lap is placed by the activity's one lap", () => {
  const result = intervalCompliance(
    activity(() => 250, 400, { laps: [{ startTime: start, elapsedSeconds: 400 }] }),
    ride([untilLap(250)]),
    {},
  );
  assert.equal(result?.alignedBy, "laps");
  assert.ok(share(result)! > 0.95);
});

test("a distance step on an activity without distance is not placed, and leaves the steps after it unplaced", () => {
  const result = intervalCompliance(
    activity(() => 200, 900),
    ride([
      {
        type: "step",
        duration: { type: "distance", meters: 5000 },
        target: { type: "power", unit: "watts", level: { kind: "constant", value: 200 } },
      },
      watts(300, 200),
    ]),
    {},
  );
  assert.deepEqual(
    result?.steps.map(({ placed }) => placed),
    [false, false],
  );
});

test("a distance ramp stopped halfway is held against the ramp by the distance covered", () => {
  const ramp: Workout = {
    name: "Ramp",
    sport: "running",
    steps: [
      {
        type: "step",
        duration: { type: "distance", meters: 1000 },
        target: { type: "pace", unit: "metersPerSecond", level: { kind: "ramp", from: 2, to: 4 } },
      },
    ],
  };
  const records = [];
  let covered = 0;
  for (let second = 0; covered < 500; second++) {
    const speed = 2 + (2 * covered) / 1000;
    records.push({ elapsedSeconds: second, speedMetresPerSecond: speed, distanceMetres: covered });
    covered += speed;
  }
  const result = intervalCompliance(
    {
      summary: {
        startTime: start,
        sport: "running",
        subSport: undefined,
        elapsedSeconds: records.length - 1,
      },
      records,
    },
    ramp,
    {},
  );
  assert.ok(share(result)! > 0.9, `${share(result)}`);
});

test("a recording gap inside a step still uses up the step's planned time, so the next step starts on time", () => {
  const records = Array.from({ length: 121 }, (_, second) => second)
    .filter((second) => second < 30 || second >= 60)
    .map((second) => ({ elapsedSeconds: second, power: second < 60 ? 200 : 300 }));
  const result = intervalCompliance(
    {
      summary: { startTime: start, sport: "cycling", subSport: undefined, elapsedSeconds: 120 },
      records,
    },
    ride([watts(60, 200), watts(60, 300)]),
    {},
  );
  assert.equal(result?.steps[1]?.secondsInTarget, 60);
  assert.ok(share(result)! > 0.95, `${share(result)}`);
});

test("short intervals held exactly are in target from their first second, with smoothing kept inside each step", () => {
  const pace = (value: number) => ({
    type: "step" as const,
    duration: { type: "time" as const, seconds: 10 },
    target: {
      type: "pace" as const,
      unit: "metersPerSecond" as const,
      level: { kind: "constant" as const, value },
    },
  });
  const run: Workout = {
    name: "Strides",
    sport: "running",
    steps: [{ type: "repeat", count: 5, steps: [pace(4), pace(2)] }],
  };
  const speedAt = (second: number) => (Math.floor(second / 10) % 2 === 0 ? 4 : 2);
  let covered = 0;
  const records = Array.from({ length: 101 }, (_, second) => {
    const record = {
      elapsedSeconds: second,
      speedMetresPerSecond: speedAt(second),
      distanceMetres: covered,
    };
    covered += speedAt(second);
    return record;
  });
  const result = intervalCompliance(
    {
      summary: { startTime: start, sport: "running", subSport: undefined, elapsedSeconds: 100 },
      records,
    },
    run,
    {},
  );
  assert.ok(share(result)! > 0.95, `${share(result)}`);
});

test("a timer pause takes exactly its own seconds out of the planned time", () => {
  const result = intervalCompliance(
    activity((second) => (second < 80 ? 200 : 300), 140, {
      events: [
        { time: new Date(start.getTime() + 30_000), event: "timer", type: "stopAll" },
        { time: new Date(start.getTime() + 50_000), event: "timer", type: "start" },
      ],
    }),
    ride([watts(60, 200), watts(60, 300)]),
    {},
  );
  assert.deepEqual(
    result?.steps.map(({ seconds, secondsInTarget }) => [seconds, secondsInTarget]),
    [
      [60, 60],
      [60, 60],
    ],
  );
});

test("a ramp followed exactly is in target, its band averaged over the same window as the value", () => {
  const ramp: Workout = {
    name: "Ramp",
    sport: "running",
    steps: [
      {
        type: "step",
        duration: { type: "time", seconds: 20 },
        target: { type: "pace", unit: "metersPerSecond", level: { kind: "ramp", from: 2, to: 6 } },
      },
    ],
  };
  let covered = 0;
  const records = Array.from({ length: 21 }, (_, second) => {
    const speed = 2 + (4 * Math.min(second, 19)) / 19;
    const record = { elapsedSeconds: second, speedMetresPerSecond: speed, distanceMetres: covered };
    covered += speed;
    return record;
  });
  const result = intervalCompliance(
    {
      summary: { startTime: start, sport: "running", subSport: undefined, elapsedSeconds: 20 },
      records,
    },
    ramp,
    {},
  );
  assert.ok(share(result)! > 0.95, `${share(result)}`);
});

test("laps that do not fit the planned steps, such as automatic laps, do not place them", () => {
  const result = intervalCompliance(
    activity((second) => (second < 60 ? 200 : 300), 120, {
      laps: [
        { startTime: start, elapsedSeconds: 90 },
        { startTime: new Date(start.getTime() + 90_000), elapsedSeconds: 30 },
      ],
    }),
    ride([watts(60, 200), watts(60, 300)]),
    {},
  );
  assert.equal(result?.alignedBy, "time");
  assert.ok(share(result)! > 0.95, `${share(result)}`);
});

test("consecutive distance steps start where the plan says the last one ended, so overshoot does not add up", () => {
  const strides: Workout = {
    name: "Strides",
    sport: "running",
    steps: [
      {
        type: "repeat",
        count: 6,
        steps: [
          {
            type: "step",
            duration: { type: "distance", meters: 100 },
            target: {
              type: "pace",
              unit: "metersPerSecond",
              level: { kind: "constant", value: 12 },
            },
          },
        ],
      },
    ],
  };
  const records = Array.from({ length: 52 }, (_, second) => ({
    elapsedSeconds: second,
    speedMetresPerSecond: 12,
    distanceMetres: second * 12,
  }));
  const result = intervalCompliance(
    {
      summary: { startTime: start, sport: "running", subSport: undefined, elapsedSeconds: 51 },
      records,
    },
    strides,
    {},
  );
  assert.deepEqual(
    result?.steps.map(({ seconds }) => seconds),
    [9, 8, 8, 9, 8, 8],
  );
});

test("a gap in the recorded distance that jumps past a whole distance step leaves that step unplaced", () => {
  const step = (value: number) => ({
    type: "step" as const,
    duration: { type: "distance" as const, meters: 100 },
    target: {
      type: "pace" as const,
      unit: "metersPerSecond" as const,
      level: { kind: "constant" as const, value },
    },
  });
  const records = Array.from({ length: 30 }, (_, second) => ({
    elapsedSeconds: second,
    speedMetresPerSecond: 10,
    distanceMetres: second < 10 ? second * 10 : 250 + (second - 10) * 10,
  }));
  const result = intervalCompliance(
    {
      summary: { startTime: start, sport: "running", subSport: undefined, elapsedSeconds: 29 },
      records,
    },
    { name: "Gap", sport: "running", steps: [step(10), step(10), step(10)] },
    {},
  );
  assert.deepEqual(
    result?.steps.map(({ placed, seconds }) => [placed, seconds]),
    [
      [true, 10],
      [false, 0],
      [true, 5],
    ],
  );
});

const lap = (from: number, seconds: number, workoutStepIndex?: number) => ({
  startTime: new Date(start.getTime() + from * 1000),
  elapsedSeconds: seconds,
  ...(workoutStepIndex === undefined ? {} : { workoutStepIndex }),
});

const stepSeconds = (result: ReturnType<typeof intervalCompliance>) =>
  result?.steps.map(({ index, seconds }) => [index, seconds]);

test("a lap the rider marks inside an interval still places the steps by their laps", () => {
  const result = intervalCompliance(
    activity((second) => (second < 600 ? 200 : 300), 900, {
      laps: [lap(0, 600, 0), lap(600, 120, 1), lap(720, 180, 1)],
    }),
    ride([watts(600, 200), watts(300, 300)]),
    {},
  );
  assert.equal(result?.alignedBy, "laps");
  assert.deepEqual(stepSeconds(result), [
    [0, 600],
    [1, 300],
  ]);
  assert.ok(share(result)! > 0.99, `${share(result)}`);
});

test("a step ridden again after going back counts both times it was ridden", () => {
  const power = (second: number) => (second < 300 || (second >= 400 && second < 700) ? 200 : 300);
  const result = intervalCompliance(
    activity(power, 1000, {
      laps: [lap(0, 300, 0), lap(300, 100, 1), lap(400, 300, 0), lap(700, 300, 1)],
    }),
    ride([watts(300, 200), watts(300, 300)]),
    {},
  );
  assert.equal(result?.alignedBy, "laps");
  assert.deepEqual(stepSeconds(result), [
    [0, 600],
    [1, 400],
  ]);
  assert.ok(share(result)! > 0.98, `${share(result)}`);
});

test("an interval the rider lengthened is its lap, however long it ran", () => {
  const result = intervalCompliance(
    activity((second) => (second < 900 ? 200 : 300), 1200, {
      laps: [lap(0, 900, 0), lap(900, 300, 1)],
    }),
    ride([watts(600, 200), watts(300, 300)]),
    {},
  );
  assert.equal(result?.alignedBy, "laps");
  assert.deepEqual(stepSeconds(result), [
    [0, 900],
    [1, 300],
  ]);
});

test("riding on after the workout ended is left out of every step", () => {
  const result = intervalCompliance(
    activity((second) => (second < 600 ? 200 : second < 900 ? 300 : 120), 1500, {
      laps: [lap(0, 600, 0), lap(600, 300, 1), lap(900, 600)],
    }),
    ride([watts(600, 200), watts(300, 300)]),
    {},
  );
  assert.equal(result?.alignedBy, "laps");
  assert.deepEqual(stepSeconds(result), [
    [0, 600],
    [1, 300],
  ]);
  assert.ok(share(result)! > 0.99, `${share(result)}`);
});

test("a step the ride never reached is not placed", () => {
  const result = intervalCompliance(
    activity(() => 200, 600, { laps: [lap(0, 600, 0)] }),
    ride([watts(600, 200), watts(300, 300)]),
    {},
  );
  assert.equal(result?.alignedBy, "laps");
  assert.deepEqual(
    result?.steps.map(({ index, placed }) => [index, placed]),
    [
      [0, true],
      [1, false],
    ],
  );
});

test("laps naming steps the planned workout does not have place nothing by step", () => {
  const result = intervalCompliance(
    activity((second) => (second < 60 ? 200 : 300), 120, {
      laps: [lap(0, 60, 4), lap(60, 60, 5)],
    }),
    ride([watts(60, 200), watts(60, 300)]),
    {},
  );
  assert.equal(result?.alignedBy, "laps");
  assert.ok(share(result)! > 0.95, `${share(result)}`);
});

test("a Ride file with a marked lap, an added minute, a step back and a free ride scores each step where it was ridden", () => {
  const file = decodeFit(trace("simulator-lap-extend-back-ride-on"));
  const quickTest = ride([watts(15, 0.5, "ftp"), watts(15, 0.75, "ftp"), watts(15, 1.2, "ftp")]);
  const result = intervalCompliance(file, quickTest, { ftp: 200 });
  assert.equal(result?.alignedBy, "laps");
  assert.deepEqual(stepSeconds(result), [
    [0, 15],
    [1, 30],
    [2, 35],
  ]);
});
