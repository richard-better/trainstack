import assert from "node:assert/strict";
import { test } from "node:test";
import { pairingChoices } from "../hosted/apps/account/src/lib/planned-actions.ts";

test("pairing keeps the planned sport family, including indoor activities", () => {
  const ride = { id: "ride", sport: "cycling", indoor: false };
  const trainer = { id: "trainer", sport: "cycling", indoor: true };
  const run = { id: "run", sport: "running" };
  const walk = { id: "walk", sport: "walking" };
  const climb = { id: "climb", sport: "bouldering" };
  const unknown = { id: "unknown", sport: null };
  const activities = [ride, trainer, run, walk, climb, unknown];
  const content = (sport) => ({ kind: "workout", workout: { sport } });
  assert.deepEqual(pairingChoices(content("cycling"), activities, null), [ride, trainer]);
  assert.deepEqual(pairingChoices(content("cycling"), activities, "ride"), [trainer]);
  assert.deepEqual(pairingChoices(content("running"), activities, null), [run, walk]);
  assert.deepEqual(pairingChoices(content("swimming"), activities, null), []);
  assert.deepEqual(pairingChoices({ kind: "rest" }, activities, null), []);
});

