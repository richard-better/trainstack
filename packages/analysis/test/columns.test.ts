import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { decodeActivityFile, streamActivityFile } from "@trainstack/activity-file";
import { profileOn, type SettingChange } from "@trainstack/zones";

import { denseFit, denseGpx, denseTcx } from "../../activity-file/test/dense.ts";
import { sampleRide, trace, traceNames } from "../../fit/test/goldens.ts";
import { analysisColumnLimits, analyzeActivity, columnsOf } from "../src/index.ts";

const changes: SettingChange[] = [
  { kind: "sport", sport: "running", listed: true },
  { kind: "threshold", sport: "running", threshold: "threshold_pace", value: 300 },
  { kind: "threshold", sport: null, threshold: "ftp", value: 250 },
  { kind: "threshold", sport: null, threshold: "max_heart_rate", value: 190 },
  { kind: "threshold", sport: null, threshold: "resting_heart_rate", value: 50 },
  { kind: "threshold", sport: null, threshold: "lactate_threshold_heart_rate", value: 165 },
];
const profile = profileOn(
  changes.map((change) => ({ day: "2026-01-01", change })),
  null,
);

const filesDirectory = new URL("../../activity-file/test/files/", import.meta.url);
const files = [
  sampleRide(),
  ...traceNames.map(trace),
  ...readdirSync(filesDirectory)
    .filter((name) => !["course.tcx", "route-without-times.gpx"].includes(name))
    .map((name) => new Uint8Array(readFileSync(new URL(name, filesDirectory)))),
];

test("analyses a file streamed into columns exactly as its decoded records", () => {
  for (const data of files) {
    assert.deepEqual(
      analyzeActivity(streamActivityFile(data, analysisColumnLimits), profile),
      analyzeActivity(decodeActivityFile(data), profile),
    );
  }
});

test("analyses columns out of time order, and past a week, as it does the same records", () => {
  const records = [
    { elapsedSeconds: 30, power: 300, heartRate: 150 },
    { elapsedSeconds: 10, power: 100, speedMetresPerSecond: 3, distanceMetres: 30 },
    { elapsedSeconds: 8 * 24 * 60 * 60, power: 999 },
    { elapsedSeconds: 20, power: 200, distanceMetres: 60 },
    { elapsedSeconds: Number.NaN, power: 500 },
    { elapsedSeconds: 20, power: 250, heartRate: 140 },
  ];
  const summary = {
    startTime: new Date("2026-05-01T00:00:00Z"),
    sport: "running",
    subSport: undefined,
    elapsedSeconds: 40,
  };
  const fromRecords = analyzeActivity({ summary, records }, profile);
  assert.deepEqual(analyzeActivity({ summary, records: columnsOf(records) }, profile), fromRecords);
  assert.equal(fromRecords.workKilojoules, 4);
});

const heapMegabytes = 16;
const fileBytes = 25 * 1024 * 1024;

test(`analyses a dense 25 MB file of each format, streamed, in a ${heapMegabytes} MB heap`, (context) => {
  const directory = mkdtempSync(join(tmpdir(), "analysis-columns-"));
  try {
    for (const [format, data] of Object.entries({
      fit: denseFit(fileBytes),
      gpx: denseGpx(fileBytes),
      tcx: denseTcx(fileBytes),
    })) {
      const path = join(directory, `dense.${format}`);
      writeFileSync(path, data);
      for (const sport of ["as recorded", "running"]) {
        const run = spawnSync(
          process.execPath,
          [
            `--max-old-space-size=${heapMegabytes}`,
            new URL("analyze-file.ts", import.meta.url).pathname,
            path,
            ...(sport === "running" ? [sport] : []),
          ],
          { encoding: "utf8" },
        );
        assert.equal(run.status, 0, run.stderr);
        const result = JSON.parse(run.stdout) as {
          records: number;
          milliseconds: number;
          rssGrowthMegabytes: number;
          maxPowerOverFiveSeconds: number;
        };
        assert.ok(result.maxPowerOverFiveSeconds > 0);
        context.diagnostic(
          `${format}, ${sport}: ${result.records} records in ${Math.round(result.milliseconds)} ms, resident memory grew ${result.rssGrowthMegabytes} MB, the file included`,
        );
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
