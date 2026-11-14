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
  });
});

test("an hour at 75 % of FTP is 56 TSS, and watts need the day's FTP", () => {
  const watts = ride([
    timeStep(3600, { type: "power", unit: "watts", level: { kind: "constant", value: 150 } }),
  ]);
  assert.equal(plannedEstimate(watts, { ftp: 200 }).load, 56);
  assert.deepEqual(plannedEstimate(watts, {}), { seconds: 3600, meters: null, load: null });
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
  assert.deepEqual(plannedEstimate(tempo, {}), { seconds: null, meters: null, load: null });
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
  assert.deepEqual(plannedEstimate(steady, {}), { seconds: 250, meters: 1000, load: null });
});
