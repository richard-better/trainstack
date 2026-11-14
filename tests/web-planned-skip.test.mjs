import assert from "node:assert/strict";
import { test } from "node:test";
import { canSkip } from "../hosted/apps/account/src/lib/planned-actions.ts";

test("completed or paired workouts never offer Skip", () => {
  const item = { content: { kind: "workout" }, state: "planned", pairing: null };
  assert.equal(canSkip(item), true);
  assert.equal(canSkip({ ...item, state: "missed" }), true);
  assert.equal(canSkip({ ...item, state: "completed" }), false);
  assert.equal(canSkip({ ...item, pairing: { activityId: "ride" } }), false);
  assert.equal(canSkip({ ...item, content: { kind: "rest" } }), false);
});
