import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { maxTimerEvents } from "@trainstack/fit";

import { sampleRide, trace, traceNames } from "../../fit/test/goldens.ts";
import {
  ActivityFileError,
  decodeActivityFile,
  streamActivityFile,
  type ActivityFileFormat,
  type ActivityRecord,
  type RecordColumns,
} from "../src/index.ts";
import { denseFit, denseGpx, denseTcx, segmentedGpx } from "./dense.ts";
import { file, fileNames, text } from "./files.ts";

const decodable = [
  sampleRide(),
  ...traceNames.map(trace),
  ...fileNames
    .filter((name) => !["course.tcx", "route-without-times.gpx"].includes(name))
    .map(file),
];

const everything = { untilSeconds: Infinity, maxRecords: 10_000_000 };

function columnsOf(records: readonly ActivityRecord[]): RecordColumns {
  const column = (value: (record: ActivityRecord) => number | undefined) =>
    Float64Array.from(records, (record) => value(record) ?? NaN);
  return {
    count: records.length,
    elapsedSeconds: column((record) => record.elapsedSeconds),
    power: column((record) => record.power),
    heartRate: column((record) => record.heartRate),
    speedMetresPerSecond: column((record) => record.speedMetresPerSecond),
    distanceMetres: column((record) => record.distanceMetres),
    altitudeMetres: column((record) => record.altitudeMetres),
    latitude: column((record) => record.latitude),
    longitude: column((record) => record.longitude),
  };
}

test("streams every file as columns equal to the full decode's records", () => {
  for (const data of decodable) {
    const { format, name, summary, laps, records, events } = decodeActivityFile(data);
    const streamed = streamActivityFile(data, everything);
    assert.deepEqual(
      { ...streamed, records: undefined },
      {
        format,
        name,
        summary,
        laps,
        events: events.filter((event) => event.event === "timer"),
        records: undefined,
      },
    );
    assert.deepEqual(streamed.records, columnsOf(records));
  }
});

test("leaves out GPX and TCX points after the limit, and rejects more within it than it may keep", () => {
  for (const name of ["strava-ride.gpx", "garmin-connect-ride.tcx"]) {
    const { records } = decodeActivityFile(file(name));
    const until = records[2]!.elapsedSeconds;
    const kept = records.filter((record) => record.elapsedSeconds <= until).length;
    const limited = streamActivityFile(file(name), { untilSeconds: until, maxRecords: kept });
    assert.equal(limited.records.count, kept, name);
    assert.throws(
      () => streamActivityFile(file(name), { untilSeconds: until, maxRecords: kept - 1 }),
      (error) => error instanceof ActivityFileError && error.code === "tooLarge",
    );
  }
});

test("rejects a GPX with more pauses than an activity can have, before keeping them all", () => {
  const segments = (count: number) =>
    text(
      `<gpx version="1.1"><trk>${Array.from(
        { length: count },
        (_, second) =>
          `<trkseg><trkpt lat="47.5" lon="19.04"><time>${new Date(Date.UTC(2026, 0, 1, 0, 0, second * 2)).toISOString()}</time></trkpt></trkseg>`,
      ).join("")}</trk></gpx>`,
    );
  const most = maxTimerEvents / 2 + 1;
  assert.equal(streamActivityFile(segments(most), everything).events.length, maxTimerEvents);
  assert.throws(
    () => streamActivityFile(segments(most + 1), everything),
    (error) => error instanceof ActivityFileError && error.code === "tooLarge",
  );
  assert.equal(decodeActivityFile(segments(most + 1)).events.length, maxTimerEvents + 2);
});

const heapMegabytes = 16;
const fileBytes = 25 * 1024 * 1024;

test(`streams a dense 25 MB file of each format in a ${heapMegabytes} MB heap, keeping a week of records`, (context) => {
  const directory = mkdtempSync(join(tmpdir(), "activity-file-streams-"));
  try {
    const files: Record<ActivityFileFormat, Uint8Array> = {
      fit: denseFit(fileBytes),
      gpx: denseGpx(fileBytes),
      tcx: denseTcx(fileBytes),
    };
    const expectedRecords = { fit: 7 * 24 * 60 * 60 + 1, gpx: undefined, tcx: undefined };
    for (const [format, data] of Object.entries(files) as [ActivityFileFormat, Uint8Array][]) {
      const path = join(directory, `dense.${format}`);
      writeFileSync(path, data);
      const run = spawnSync(
        process.execPath,
        [
          `--max-old-space-size=${heapMegabytes}`,
          new URL("summarize-file.ts", import.meta.url).pathname,
          path,
          "streams",
        ],
        { encoding: "utf8" },
      );
      assert.equal(run.status, 0, run.stderr);
      const result = JSON.parse(run.stdout) as {
        streamedRecords: number;
        maxRssKilobytes: number;
        rssBeforeKilobytes: number;
      };
      if (expectedRecords[format] !== undefined) {
        assert.equal(result.streamedRecords, expectedRecords[format]);
      }
      context.diagnostic(
        `${format}: ${result.streamedRecords} records, resident memory grew ${Math.round((result.maxRssKilobytes - result.rssBeforeKilobytes) / 1024)} MB`,
      );
    }
    const segmented = streamActivityFile(segmentedGpx(64 * 1024), everything);
    assert.ok(segmented.events.length > 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("refuses a GPX of more points at one moment than it may keep, holding no more than that", () => {
  const directory = mkdtempSync(join(tmpdir(), "activity-file-crafted-"));
  try {
    const point = `<trkpt><time>2026-01-01T00:00:00Z</time></trkpt>`;
    const count = 1_100_000;
    const path = join(directory, "crafted.gpx");
    writeFileSync(
      path,
      `<gpx version="1.1"><trk><trkseg>${point.repeat(count)}</trkseg></trk></gpx>`,
    );
    const run = spawnSync(
      process.execPath,
      [
        `--max-old-space-size=${heapMegabytes}`,
        new URL("stream-crafted-file.ts", import.meta.url).pathname,
        path,
      ],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout) as { code: string; rssGrowthMegabytes: number };
    assert.equal(result.code, "tooLarge");
    assert.ok(result.rssGrowthMegabytes < 64, `grew ${result.rssGrowthMegabytes} MB`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
