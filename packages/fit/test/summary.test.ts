import assert from "node:assert/strict";
import { test } from "node:test";

import { FitDecodeError, decodeFit, summarizeFit } from "../src/index.ts";
import { FitWriter, fitTime } from "./fit-writer.ts";
import { sampleRide, trace, traceNames } from "./goldens.ts";

const goldens = {
  sampleRide: sampleRide(),
  ...Object.fromEntries(traceNames.map((name) => [name, trace(name)])),
};

test("summarizes each golden file exactly as the full decode does, without its records", () => {
  for (const [name, data] of Object.entries(goldens)) {
    const { fileId, workoutName, summary, sessions, laps } = decodeFit(data);
    assert.deepEqual(summarizeFit(data), { fileId, workoutName, summary, sessions, laps }, name);
  }
});

test("fails as the full decode does", () => {
  const data = sampleRide();
  data[Math.floor(data.length / 2)]! ^= 0xff;
  assert.throws(
    () => summarizeFit(data),
    (error) => error instanceof FitDecodeError && error.code === "badChecksum",
  );
});

test("rejects a file with more laps than an activity can have, before keeping them all", () => {
  const writer = new FitWriter().define(0, 19, [
    { number: 253, type: "uint32" },
    { number: 2, type: "uint32" },
  ]);
  const start = fitTime("2026-01-01T00:00:00Z");
  for (let index = 0; index <= 10_000; index++) writer.data(0, [start + index, start + index]);
  const data = writer.file();
  for (const decode of [decodeFit, summarizeFit]) {
    assert.throws(
      () => decode(data),
      (error) => error instanceof FitDecodeError && error.code === "tooLarge",
    );
  }
});
