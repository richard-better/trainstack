import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionLoad, tssPerHour } from "../src/index.ts";

test("Friel's table gives an hour at RPE 4 50, at RPE 6 70 and at RPE 8 100", () => {
  assert.equal(tssPerHour(4), 50);
  assert.equal(tssPerHour(6), 70);
  assert.equal(tssPerHour(8), 100);
  assert.equal(tssPerHour(10), 140);
});

test("a half point lies halfway between its neighbours", () => {
  assert.equal(tssPerHour(7.5), 90);
});

test("a 75-minute session at RPE 7 is 525 in Foster's units and 100 as a stress score", () => {
  assert.deepEqual(sessionLoad(7, 75 * 60), { sessionRpeLoad: 525, stressScore: 100 });
});

test("a session without an RPE has no load", () => {
  assert.equal(sessionLoad(null, 3600), null);
});
