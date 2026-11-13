import assert from "node:assert/strict";
import { test } from "node:test";

import { activitySport } from "../src/index.ts";
import { sportFromName } from "../src/sports.ts";

test("a sport recorded indoors is the same sport, marked indoor", () => {
  assert.deepEqual(activitySport("cycling", "indoorCycling"), { sport: "cycling", indoor: true });
  assert.deepEqual(activitySport("cycling", "virtualActivity"), { sport: "cycling", indoor: true });
  assert.deepEqual(activitySport("cycling", "road"), { sport: "cycling", indoor: false });
  assert.deepEqual(activitySport("running", "treadmill"), { sport: "running", indoor: true });
  assert.deepEqual(activitySport("running", "indoorRunning"), { sport: "running", indoor: true });
  assert.deepEqual(activitySport("running", undefined), { sport: "running", indoor: false });
});

test("strength training is strength, and climbing is bouldering only when the file says so", () => {
  assert.deepEqual(activitySport("training", "strengthTraining"), {
    sport: "strength",
    indoor: false,
  });
  assert.deepEqual(activitySport("rockClimbing", "bouldering"), {
    sport: "bouldering",
    indoor: false,
  });
  assert.deepEqual(activitySport("rockClimbing", "indoorClimbing"), {
    sport: "climbing",
    indoor: true,
  });
});

test("other sports keep their FIT name in snake case, and a generic one has none", () => {
  assert.deepEqual(activitySport("crossCountrySkiing", undefined), {
    sport: "cross_country_skiing",
    indoor: false,
  });
  assert.deepEqual(activitySport("generic", "indoorCycling"), { sport: undefined, indoor: true });
  assert.deepEqual(activitySport(undefined, undefined), { sport: undefined, indoor: false });
});

test("a GPX or TCX sport name maps through the same vocabulary", () => {
  const { sport, subSport } = sportFromName("VirtualRide");
  assert.deepEqual(activitySport(sport, subSport), { sport: "cycling", indoor: true });
});
