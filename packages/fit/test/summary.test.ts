import assert from "node:assert/strict";
import { test } from "node:test";

import { FitDecodeError, decodeFit, summarizeFit } from "../src/index.ts";
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
