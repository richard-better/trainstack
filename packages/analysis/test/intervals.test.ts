import assert from "node:assert/strict";
import { test } from "node:test";

import type { Workout } from "@trainstack/workout";

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
    activity((second) => (second < 300 ? 100 + (100 * second) / 299 : 150), 600, {
      laps: [
        { startTime: start, elapsedSeconds: 300 },
        { startTime: new Date(start.getTime() + 300_000), elapsedSeconds: 300 },
      ],
    }),
    ramp,
    {},
  );
  assert.equal(result?.alignedBy, "laps");
  assert.ok(share(result)! > 0.95, `${share(result)}`);
});
