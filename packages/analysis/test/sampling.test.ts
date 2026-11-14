import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { decodeActivityFile } from "@trainstack/activity-file";
import { decodeFit } from "@trainstack/fit";
import { profileOn } from "@trainstack/zones";

import {
  analyzeActivity,
  heldSegments,
  perSecond,
  samplesOf,
  samplingRule,
  timerPauses,
  workKilojoules,
} from "../src/index.ts";
import { smartRecordedRide } from "./smart-recorded-ride.ts";

const start = new Date("2026-05-01T07:00:00Z");
const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);
const timer = (seconds: number, type: string) => ({ time: at(seconds), event: "timer", type });

describe("timer pauses", () => {
  test("run from a stop to the next start", () => {
    assert.deepEqual(
      timerPauses(
        [
          timer(0, "start"),
          timer(30, "stopAll"),
          { time: at(40), event: "powerDown", type: "stop" },
          timer(150, "start"),
          timer(200, "stop"),
          timer(210, "stopDisableAll"),
          timer(260, "start"),
          timer(300, "start"),
          timer(400, "stopAll"),
        ],
        start,
      ),
      [
        { from: 30, to: 150 },
        { from: 200, to: 260 },
        { from: 400, to: Infinity },
      ],
    );
  });

  test("are none when the file has no timer events", () => {
    assert.deepEqual(timerPauses([{ time: at(5), event: "lap", type: "stop" }], start), []);
  });
});

describe("the sampling rule", () => {
  const elapsed = Float64Array.from([0, 30, 61, 70, 80]);

  test("holds a value until the next record at most 30 s later", () => {
    assert.equal(samplingRule.maxHeldGapSeconds, 30);
    const held = heldSegments(elapsed, []);
    assert.deepEqual(
      [...held.record].map((record, index) => [record, held.start[index], held.end[index]]),
      [
        [0, 0, 30],
        [2, 61, 70],
        [3, 70, 80],
      ],
    );
  });

  test("holds nothing while the timer is stopped, even across a short gap", () => {
    const held = heldSegments(elapsed, [{ from: 65, to: 72 }]);
    assert.deepEqual(
      [...held.record].map((record, index) => [record, held.start[index], held.end[index]]),
      [
        [0, 0, 30],
        [2, 61, 65],
      ],
    );
  });

  test("never lets a record written while the timer is stopped hold after the restart", () => {
    const records = [0, 10, 20].map((elapsedSeconds) => ({ elapsedSeconds, power: 300 }));
    const samples = samplesOf(records, "cycling", { pauses: [{ from: 5, to: 15 }] });
    assert.deepEqual(
      [...perSecond(samples, samples.power)],
      [300, 300, 300, 300, 300, ...Array<number>(15).fill(0), 300],
    );
  });

  test("holds no value across a pause, whether or not a record was written while stopped", () => {
    for (const times of [
      [0, 10, 20],
      [0, 20],
    ]) {
      const pauses = [{ from: 5, to: 15 }];
      const held = heldSegments(Float64Array.from(times), pauses);
      assert.deepEqual(
        [...held.record].map((record, index) => [record, held.start[index], held.end[index]]),
        [[0, 0, 5]],
      );
      const records = times.map((elapsedSeconds) => ({ elapsedSeconds, power: 300 }));
      const samples = samplesOf(records, "cycling", { pauses });
      assert.deepEqual(
        [...perSecond(samples, samples.power)],
        [300, 300, 300, 300, 300, ...Array<number>(15).fill(0), 300],
      );
      assert.equal(workKilojoules(samples), 2);
    }
  });

  test("takes no speed from distance across a pause", () => {
    const run = samplesOf(
      [
        { elapsedSeconds: 0, distanceMetres: 0 },
        { elapsedSeconds: 5, distanceMetres: 10 },
        { elapsedSeconds: 25, distanceMetres: 10 },
        { elapsedSeconds: 30, distanceMetres: 20 },
      ],
      "running",
      { pauses: [{ from: 5, to: 25 }] },
    );
    assert.deepEqual([...run.speed], [NaN, 2, NaN, 2]);
  });

  test("fills no second for a record written while the timer is stopped", () => {
    const records = [0, 1, 2, 10, 20, 21, 22].map((elapsedSeconds) => ({
      elapsedSeconds,
      power: 1000,
    }));
    const samples = samplesOf(records, "cycling", { pauses: [{ from: 2, to: 20 }] });
    assert.deepEqual(
      [...perSecond(samples, samples.power)]
        .map((power, second) => (power ? second : -1))
        .filter((second) => second >= 0),
      [0, 1, 2, 20, 21, 22],
    );
    assert.equal(workKilojoules(samples), 4);
  });
});

const thresholds = profileOn(
  [
    { day: "2026-01-01", change: { kind: "threshold", sport: null, threshold: "ftp", value: 250 } },
    {
      day: "2026-01-01",
      change: { kind: "threshold", sport: null, threshold: "max_heart_rate", value: 190 },
    },
  ],
  null,
);

describe("smart recording", () => {
  test("a FIT ride written every 6 and 8 s, with a 45 s dropout and a 60 s timer pause", () => {
    const analysis = analyzeActivity(decodeFit(smartRecordedRide()), thresholds);
    assert.equal(analysis.workKilojoules, 135);
    assert.equal(analysis.normalizedPowerWatts, 239);
    assert.deepEqual(
      analysis.powerCurve.map(({ durationSeconds, watts }) => [durationSeconds, watts]),
      [
        [5, 300],
        [15, 300],
        [30, 300],
        [60, 300],
        [300, 238],
        [600, 204],
      ],
    );
    assert.deepEqual(
      analysis.timeInZones.heart_rate?.map(({ seconds }) => seconds),
      [0, 0, 360, 200, 0],
    );
  });

  test("Garmin Connect's TCX ride, recorded every 15 to 30 s with a pause between tracks", () => {
    const file = new URL("../../activity-file/test/files/garmin-connect-ride.tcx", import.meta.url);
    const analysis = analyzeActivity(
      decodeActivityFile(new Uint8Array(readFileSync(file))),
      thresholds,
    );
    assert.equal(analysis.workKilojoules, 13);
    assert.equal(analysis.normalizedPowerWatts, 123);
    assert.deepEqual(
      analysis.powerCurve.map(({ watts }) => watts),
      [260, 260, 238, 126],
    );
    assert.deepEqual(
      analysis.timeInZones.heart_rate?.map(({ seconds }) => seconds),
      [0, 30, 31, 0, 0],
    );
  });
});
