import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FitDecodeError,
  decodeFit,
  maxTimerEvents,
  streamFit,
  type FitRecord,
  type RecordColumns,
} from "../src/index.ts";
import { FitWriter, fitTime } from "./fit-writer.ts";
import { sampleRide, trace, traceNames } from "./goldens.ts";

const goldens = {
  sampleRide: sampleRide(),
  ...Object.fromEntries(traceNames.map((name) => [name, trace(name)])),
};

const everything = { untilSeconds: Infinity, maxRecords: 10_000_000 };

function columnsOf(records: readonly FitRecord[]): RecordColumns {
  const column = (value: (record: FitRecord) => number | undefined) =>
    Float64Array.from(records, (record) => value(record) ?? NaN);
  return {
    count: records.length,
    elapsedSeconds: column((record) => record.elapsedSeconds),
    power: column((record) => record.power),
    heartRate: column((record) => record.heartRate),
    speedMetresPerSecond: column((record) => record.speedMetresPerSecond),
    distanceMetres: column((record) => record.distanceMetres),
    altitudeMetres: column((record) => record.altitudeMetres),
  };
}

test("streams each golden file's records as columns equal to the full decode's records", () => {
  for (const [name, data] of Object.entries(goldens)) {
    const { fileId, workoutName, summary, sessions, laps, records, events } = decodeFit(data);
    const streamed = streamFit(data, everything);
    assert.deepEqual(
      { ...streamed, records: undefined },
      {
        fileId,
        workoutName,
        summary,
        sessions,
        laps,
        events: events.filter((event) => event.event === "timer"),
        records: undefined,
      },
      name,
    );
    assert.deepEqual(streamed.records, columnsOf(records), name);
  }
});

function oneRecordPerSecond(seconds: number, events = 0) {
  const start = fitTime("2026-03-01T06:00:00Z");
  const writer = new FitWriter()
    .define(0, 20, [
      { number: 253, type: "uint32" },
      { number: 7, type: "uint16" },
    ])
    .define(1, 21, [
      { number: 253, type: "uint32" },
      { number: 0, type: "enum" },
      { number: 1, type: "enum" },
    ]);
  for (let second = 0; second < seconds; second++) writer.data(0, [start + second, 200]);
  for (let index = 0; index < events; index++) {
    writer.data(1, [start + index, 0, index % 2 === 0 ? 4 : 0]);
  }
  return writer.file();
}

test("leaves out records after the limit, counting from the activity's start", () => {
  const { records } = streamFit(oneRecordPerSecond(10), { untilSeconds: 6, maxRecords: 100 });
  assert.equal(records.count, 7);
  assert.deepEqual([...records.elapsedSeconds], [0, 1, 2, 3, 4, 5, 6]);
});

test("rejects more records within the limit than it may keep, and keeps exactly as many", () => {
  const data = oneRecordPerSecond(10);
  assert.equal(streamFit(data, { untilSeconds: Infinity, maxRecords: 10 }).records.count, 10);
  assert.throws(
    () => streamFit(data, { untilSeconds: Infinity, maxRecords: 9 }),
    (error) => error instanceof FitDecodeError && error.code === "tooLarge",
  );
  assert.equal(streamFit(data, { untilSeconds: 8, maxRecords: 9 }).records.count, 9);
});

test("rejects more timer events than an activity can have, before keeping them all", () => {
  assert.equal(
    streamFit(oneRecordPerSecond(1, maxTimerEvents), everything).events.length,
    maxTimerEvents,
  );
  assert.throws(
    () => streamFit(oneRecordPerSecond(1, maxTimerEvents + 1), everything),
    (error) => error instanceof FitDecodeError && error.code === "tooLarge",
  );
});
