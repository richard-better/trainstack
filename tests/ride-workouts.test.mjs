import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { flatten, workoutSchema } from "../packages/workout/src/index.ts";

const folder = "apps/ride/RideKit/Tests/RideDataTests/Workouts";
const cases = JSON.parse(readFileSync(`${folder}/workouts.json`, "utf8"));
const played = JSON.parse(readFileSync(`${folder}/played.json`, "utf8"));

test("Ride's workout cases are valid in the workout model", () => {
  for (const { name, workout } of cases) {
    assert.deepEqual(workoutSchema.parse(workout), workout, name);
  }
});

test("Ride plays each step of a workout it can ride as flatten expands it", () => {
  assert.deepEqual(
    played.map((entry) => entry.name),
    cases.map((entry) => entry.name),
  );
  for (const [index, { name, workout }] of cases.entries()) {
    const ride = played[index];
    if (ride.reason !== undefined) {
      assert.equal(ride.steps.length, 0, name);
      continue;
    }
    const expected = flatten(workout.steps).map(({ intensity: _intensity, ...step }) => step);
    assert.deepEqual(ride.steps, expected, name);
  }
});

test("Ride refuses only cycling workouts with pace or distance, and every other sport", () => {
  for (const [index, { name, workout }] of cases.entries()) {
    const steps = flatten(workout.steps);
    const unrideable =
      workout.sport !== "cycling" ||
      steps.some((step) => step.target?.type === "pace" || step.duration.type === "distance");
    assert.equal(played[index].reason !== undefined, unrideable, name);
  }
});
