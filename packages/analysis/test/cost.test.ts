import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { profileOn } from "@trainstack/zones";

import { analyzeActivity } from "../src/index.ts";
import { growthExponent } from "./measure.ts";

const heapMegabytes = 24;

test(`analyzes a 24 hour run at 1 Hz in under a second of CPU, with a ${heapMegabytes} MB heap of which its records take 20`, () => {
  const run = spawnSync(
    process.execPath,
    [`--max-old-space-size=${heapMegabytes}`, new URL("day-long.ts", import.meta.url).pathname],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout) as {
    records: number;
    cpuMilliseconds: number;
    typedArrayBytes: number;
    efforts: number;
    laps: number;
  };
  assert.equal(result.records, 24 * 60 * 60 + 1);
  assert.equal(result.efforts, 7);
  assert.equal(result.laps, 96);
  assert.ok(result.cpuMilliseconds < 1000, `${result.cpuMilliseconds} ms of CPU`);
  assert.ok(result.typedArrayBytes < 16 * 1024 * 1024, `${result.typedArrayBytes} bytes`);
});

test("analyzes a lap per record in time that grows with the records, not records times laps", () => {
  const start = new Date("2026-05-01T00:00:00Z");
  const lapPerRecord = (count: number) => {
    const activity = {
      summary: { startTime: start, sport: "cycling", subSport: undefined, elapsedSeconds: count },
      records: Array.from({ length: count }, (_, second) => ({
        elapsedSeconds: second,
        heartRate: 140,
      })),
      laps: Array.from({ length: count }, (_, second) => ({
        startTime: new Date(start.getTime() + second * 1000),
        elapsedSeconds: 1,
      })),
    };
    return () => {
      assert.equal(analyzeActivity(activity, profileOn([], null)).laps.length, count);
    };
  };
  const exponent = growthExponent(lapPerRecord, [5_000, 10_000, 20_000, 40_000]);
  assert.ok(exponent < 1.5, `the CPU grew as the laps to the power ${exponent.toFixed(2)}`);
});
