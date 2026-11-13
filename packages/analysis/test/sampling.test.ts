import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { decodeActivityFile } from "@trainstack/activity-file";
import { decodeFit } from "@trainstack/fit";
import { profileOn } from "@trainstack/zones";

import { FitWriter, fitTime, type FieldSpec } from "../../fit/test/fit-writer.ts";
import {
  analyzeActivity,
  heldSegments,
  perSecond,
  samplesOf,
  samplingRule,
  timerPauses,
  workKilojoules,
} from "../src/index.ts";

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
        [3, 72, 80],
      ],
    );
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

const fileIdFields: FieldSpec[] = [
  { number: 0, type: "enum" },
  { number: 4, type: "uint32" },
];
const eventFields: FieldSpec[] = [
  { number: 253, type: "uint32" },
  { number: 0, type: "enum" },
  { number: 1, type: "enum" },
];
const recordFields: FieldSpec[] = [
  { number: 253, type: "uint32" },
  { number: 7, type: "uint16" },
  { number: 3, type: "uint8" },
];
const sessionFields: FieldSpec[] = [
  { number: 253, type: "uint32" },
  { number: 2, type: "uint32" },
  { number: 5, type: "enum" },
  { number: 7, type: "uint32" },
  { number: 8, type: "uint32" },
];

function smartRecordedRide(): Uint8Array {
  const zero = fitTime(start.toISOString());
  const writer = new FitWriter()
    .define(0, 0, fileIdFields)
    .data(0, [4, zero])
    .define(1, 21, eventFields)
    .define(2, 20, recordFields);
  const event = (seconds: number, type: number) => writer.data(1, [zero + seconds, 0, type]);
  const records = (from: number, to: number, every: number, power: number, heartRate: number) => {
    for (let seconds = from; seconds <= to; seconds += every) {
      writer.data(2, [zero + seconds, power, heartRate]);
    }
  };
  event(0, 0);
  records(0, 300, 6, 200, 140);
  records(345, 545, 8, 300, 160);
  event(545, 4);
  event(605, 0);
  records(605, 665, 5, 250, 150);
  event(665, 4);
  return writer
    .define(3, 18, sessionFields)
    .data(3, [zero + 665, zero, 2, 665_000, 545_000])
    .file();
}

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
