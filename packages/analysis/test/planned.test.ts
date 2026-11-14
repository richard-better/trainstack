import assert from "node:assert/strict";
import { test } from "node:test";

import type { Step, Workout } from "@trainstack/workout";

import { plannedEstimate, unguidedShares } from "../src/index.ts";

const timeStep = (seconds: number, target?: Step["target"], intensity?: Step["intensity"]) =>
  ({
    type: "step",
    duration: { type: "time", seconds },
    ...(target ? { target } : {}),
    ...(intensity ? { intensity } : {}),
  }) satisfies Step;

const distanceStep = (meters: number, target?: Step["target"]) =>
  ({
    type: "step",
    duration: { type: "distance", meters },
    ...(target ? { target } : {}),
  }) satisfies Step;

const ftpShare = (value: number) =>
  ({ type: "power", unit: "ftp", level: { kind: "constant", value } }) as const;

const ride = (steps: Workout["steps"]): Workout => ({ name: "Ride", sport: "cycling", steps });
const run = (steps: Workout["steps"]): Workout => ({ name: "Run", sport: "running", steps });

test("an hour at FTP is 100 TSS, by the definition of TSS", () => {
  assert.deepEqual(plannedEstimate(ride([timeStep(3600, ftpShare(1))]), {}), {
    seconds: 3600,
    meters: null,
    load: 100,
    includesExpected: false,
  });
});

test("an hour at 75 % of FTP is 56 TSS, and watts need the day's FTP", () => {
  const watts = ride([
    timeStep(3600, { type: "power", unit: "watts", level: { kind: "constant", value: 150 } }),
  ]);
  assert.equal(plannedEstimate(watts, { ftp: 200 }).load, 56);
  assert.deepEqual(plannedEstimate(watts, {}), {
    seconds: 3600,
    meters: null,
    load: null,
    includesExpected: false,
  });
});

test("intervals count by their normalized intensity, so they weigh more than their average", () => {
  const intervals = ride([
    {
      type: "repeat",
      count: 6,
      steps: [timeStep(300, ftpShare(1.2)), timeStep(300, ftpShare(0.5))],
    },
  ]);
  const average = (1.2 + 0.5) / 2;
  const estimate = plannedEstimate(intervals, {});
  assert.equal(estimate.seconds, 3600);
  assert.ok(estimate.load! > Math.round(100 * average ** 2), `${estimate.load}`);
  assert.ok(estimate.load! < 100 * 1.2 ** 2);
});

test("ranges count at their middle, ramps along their length", () => {
  const range = ride([
    timeStep(3600, { type: "power", unit: "ftp", level: { kind: "range", low: 0.9, high: 1.1 } }),
  ]);
  assert.equal(plannedEstimate(range, {}).load, 100);
  const ramp = ride([
    timeStep(3600, { type: "power", unit: "ftp", level: { kind: "ramp", from: 0.5, to: 1 } }),
  ]);
  const load = plannedEstimate(ramp, {}).load!;
  assert.ok(load > 100 * 0.75 ** 2 && load < 100, `${load}`);
});

test("steps without a target count at a stated share of threshold by their intensity", () => {
  const free = ride([timeStep(3600, undefined, "recovery")]);
  assert.equal(plannedEstimate(free, {}).load, Math.round(100 * unguidedShares.recovery ** 2));
  assert.equal(
    plannedEstimate(ride([timeStep(3600)]), {}).load,
    Math.round(100 * unguidedShares.unset ** 2),
  );
});

test("a distance run takes its time and load from the day's threshold pace", () => {
  const thresholdSpeed = 1000 / 240;
  const tempo = run([
    distanceStep(10_000, {
      type: "pace",
      unit: "threshold",
      level: { kind: "constant", value: 1 },
    }),
  ]);
  const estimate = plannedEstimate(tempo, { thresholdSpeed });
  assert.equal(estimate.meters, 10_000);
  assert.ok(Math.abs(estimate.seconds! - 2400) < 1e-9);
  assert.equal(estimate.load, Math.round((2400 / 3600) * 100));
  assert.deepEqual(plannedEstimate(tempo, {}), {
    seconds: null,
    meters: null,
    load: null,
    includesExpected: false,
  });
});

test("a run mixing time and distance gives its whole distance", () => {
  const thresholdSpeed = 4;
  const mixed = run([
    timeStep(600, { type: "pace", unit: "threshold", level: { kind: "constant", value: 0.5 } }),
    distanceStep(2000, {
      type: "pace",
      unit: "metersPerSecond",
      level: { kind: "constant", value: 4 },
    }),
  ]);
  const estimate = plannedEstimate(mixed, { thresholdSpeed });
  assert.equal(estimate.seconds, 1100);
  assert.equal(estimate.meters, 600 * 2 + 2000);
});

test("heart rate in beats per minute needs the day's lactate threshold heart rate", () => {
  const steady = ride([
    timeStep(3600, { type: "heartRate", unit: "bpm", level: { kind: "constant", value: 170 } }),
  ]);
  assert.equal(plannedEstimate(steady, { lactateThresholdHeartRate: 170 }).load, 100);
  assert.equal(plannedEstimate(steady, {}).load, null);
});

test("a distance step at a speed in metres per second takes its time without a threshold", () => {
  const steady = run([
    distanceStep(1000, {
      type: "pace",
      unit: "metersPerSecond",
      level: { kind: "constant", value: 4 },
    }),
  ]);
  assert.deepEqual(plannedEstimate(steady, {}), {
    seconds: 250,
    meters: 1000,
    load: null,
    includesExpected: false,
  });
});

const openStep = (
  expected?: Step["duration"] & { type: "time" | "distance" },
  target?: Step["target"],
) =>
  ({
    type: "step",
    duration: expected ? { type: "open", expected } : { type: "open" },
    ...(target ? { target } : {}),
  }) satisfies Step;

test("a lap-button step counts at its expected length, and the estimate says it rests on it", () => {
  const warmed = ride([
    openStep({ type: "time", seconds: 600 }, ftpShare(1)),
    timeStep(3000, ftpShare(1)),
  ]);
  assert.deepEqual(plannedEstimate(warmed, {}), {
    seconds: 3600,
    meters: null,
    load: 100,
    includesExpected: true,
  });
});

test("a lap-button step expected to cover a distance takes the time its speed needs", () => {
  const easy = run([
    openStep(
      { type: "distance", meters: 1000 },
      { type: "pace", unit: "metersPerSecond", level: { kind: "constant", value: 4 } },
    ),
  ]);
  assert.deepEqual(plannedEstimate(easy, {}), {
    seconds: 250,
    meters: 1000,
    load: null,
    includesExpected: true,
  });
});

test("a lap-button step with no expected length leaves every figure unknown, not zero", () => {
  const unknown = ride([openStep(undefined, ftpShare(0.5)), timeStep(3600, ftpShare(1))]);
  assert.deepEqual(plannedEstimate(unknown, {}), {
    seconds: null,
    meters: null,
    load: null,
    includesExpected: false,
  });
});
