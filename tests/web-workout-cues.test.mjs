import assert from "node:assert/strict";
import { test } from "node:test";
import { cueText } from "../hosted/apps/account/src/lib/workout-cues.ts";

test("zero time and distance cues read at the start", () => {
  for (const at of [
    { type: "time", seconds: 0 },
    { type: "distance", meters: 0 },
  ]) {
    assert.equal(cueText({ at, text: "Warm up" }), "At the start: Warm up");
  }
  assert.equal(cueText({ at: { type: "time", seconds: 30 }, text: "Go" }), "30 s in: Go");
  assert.equal(cueText({ at: { type: "distance", meters: 500 }, text: "Go" }), "500 m in: Go");
});
