import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { isDefinedError, safe } from "@orpc/client";
import { decodeFitWorkout } from "../packages/fit/src/index.ts";
import { flatten, parseFit } from "../packages/workout/src/index.ts";
import { mockApple } from "./helpers/apple.mjs";
import { migrate, rpcClient, startWorker } from "./helpers/worker.mjs";

let worker;
let runtime;
const apple = mockApple();

before(
  async () => {
    worker = await startWorker({ outboundService: apple.fetch });
    runtime = worker.runtime;
    await migrate(runtime);
  },
  { timeout: 60_000 },
);

after(async () => {
  await worker?.dispose();
});

async function athlete() {
  const signedIn = await apple.signIn(runtime, { email: `${randomUUID()}@example.com` });
  return rpcClient(runtime, { token: signedIn.token });
}

const at = (minute) => new Date(Date.UTC(2026, 10, 13, 9, minute));

const reference = (name) =>
  new File([readFileSync(`packages/fit/test/fixtures/workouts/${name}`)], name);

const sampleRide = () =>
  new File(
    [readFileSync("apps/ride/RideKit/Sources/RideData/Resources/SampleRide.fit")],
    "Morning ride.fit",
  );

async function definedError(promise, code) {
  const [error] = await safe(promise);
  assert.ok(isDefinedError(error), `expected ${code}, got ${error}`);
  assert.equal(error.code, code);
  return error;
}

const threshold = (name, value, sport = null) => ({
  day: "2026-01-01",
  change: { kind: "threshold", sport, threshold: name, value },
  updatedAt: at(0),
});

const fromBase64 = (text) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

const steady = (seconds, value) => ({
  type: "step",
  duration: { type: "time", seconds },
  target: { type: "power", unit: "ftp", level: { kind: "constant", value } },
});

test("a FIT workout file imports beside the text formats and remembers it came from FIT", async () => {
  const client = await athlete();
  const id = randomUUID();
  const imported = await client.workouts.import({
    file: reference("trainingpeaks-bike.fit"),
    id,
    updatedAt: at(0),
  });
  assert.deepEqual(imported.warnings, []);
  assert.equal(imported.workout.name, "Over-unders 3 x 9");
  assert.deepEqual(imported.workout.origin, {
    kind: "file",
    format: "fit",
    fileName: "trainingpeaks-bike.fit",
  });
  assert.equal(imported.workout.totals.seconds, 900 + 3 * 180 + 300 + 600);
});

test("a FIT zone imports as the athlete's own zone from their settings today, and says so", async () => {
  const client = await athlete();
  const refused = await definedError(
    client.workouts.import({
      file: reference("garmin-connect-run-intervals.fit"),
      id: randomUUID(),
      updatedAt: at(0),
    }),
    "WORKOUT_FORMAT_ERROR",
  );
  assert.deepEqual(refused.data, {
    format: "fit",
    issues: [
      {
        code: "unsupported",
        message:
          "Heart rate zone 2 refers to zones of the athlete's own; set heart rate zones to import it",
        at: "step 1",
      },
    ],
  });

  await client.settings.write({ writes: [threshold("max_heart_rate", 190)] });
  const zones = await client.settings.zones({ day: "2026-11-13", sport: "running" });
  const zone2 = zones.zones.heart_rate.zones[1];
  const imported = await client.workouts.import({
    file: reference("garmin-connect-run-intervals.fit"),
    id: randomUUID(),
    updatedAt: at(0),
  });
  assert.equal(imported.warnings.length, 1);
  assert.match(
    imported.warnings[0].message,
    new RegExp(
      `^Heart rate zone 2 became ${zone2.start}-${zone2.end} bpm from your settings on \\d{4}-\\d{2}-\\d{2}$`,
    ),
  );
  assert.deepEqual(imported.workout.workout.steps[0].target, {
    type: "heartRate",
    unit: "bpm",
    level: { kind: "range", low: zone2.start, high: zone2.end },
  });
});

test("percent of max heart rate imports from the athlete's max heart rate", async () => {
  const client = await athlete();
  await client.settings.write({ writes: [threshold("max_heart_rate", 200)] });
  const imported = await client.workouts.import({
    file: reference("trainingpeaks-run-heart-rate.fit"),
    id: randomUUID(),
    updatedAt: at(0),
  });
  assert.deepEqual(imported.workout.workout.steps[0].target, {
    type: "heartRate",
    unit: "bpm",
    level: { kind: "range", low: 120, high: 140 },
  });
  assert.equal(imported.warnings[0].code, "converted");
});

test("a FIT activity dropped on the workouts import is told apart from a workout", async () => {
  const client = await athlete();
  const refused = await definedError(
    client.workouts.import({ file: sampleRide(), id: randomUUID(), updatedAt: at(0) }),
    "WORKOUT_FORMAT_ERROR",
  );
  assert.deepEqual(refused.data, {
    format: "fit",
    issues: [
      {
        code: "unsupported",
        message: "The file is a FIT activity, a record of a session done, not a workout",
      },
    ],
  });
});

test("a lap-button step is refused by name", async () => {
  const client = await athlete();
  const refused = await definedError(
    client.workouts.import({
      file: reference("garmin-connect-lap-button.fit"),
      id: randomUUID(),
      updatedAt: at(0),
    }),
    "WORKOUT_FORMAT_ERROR",
  );
  assert.equal(
    refused.data.issues[0].message,
    "Step 1 lasts until the lap button is pressed, and TrainStack does not support lap-button steps yet",
  );
});

test("a stored workout exports as FIT bytes in base64 that read back to the same steps", async () => {
  const client = await athlete();
  const id = randomUUID();
  const workout = {
    name: "Over-unders 2×10",
    sport: "cycling",
    focus: "threshold",
    steps: [
      steady(600, 0.5),
      { type: "repeat", count: 3, steps: [steady(120, 1.04), steady(180, 0.72)] },
      steady(300, 0.5),
    ],
  };
  await client.workouts.put({ id, workout, updatedAt: at(0) });
  const exported = await client.workouts.export({ id, format: "fit" });
  assert.equal(exported.fileName, "over-unders-2x10.fit");
  assert.equal(exported.contentType, "application/vnd.ant.fit");
  assert.equal(exported.text, undefined);
  assert.deepEqual(
    exported.warnings.map((warning) => warning.message),
    ['Focus "threshold" has no place in a .fit file'],
  );
  const bytes = fromBase64(exported.base64);
  assert.equal(decodeFitWorkout(bytes).fileId.type, "workout");
  assert.deepEqual(flatten(parseFit(bytes).value.steps), flatten(workout.steps));

  const back = await client.workouts.import({
    file: new File([bytes], exported.fileName),
    id: randomUUID(),
    updatedAt: at(0),
  });
  assert.deepEqual(back.workout.workout.steps, workout.steps);
});

test("ramps export to FIT only when asked to approximate, and thresholds come from settings", async () => {
  const client = await athlete();
  const id = randomUUID();
  await client.workouts.put({
    id,
    workout: {
      name: "Ramp run",
      sport: "running",
      steps: [
        {
          type: "step",
          duration: { type: "time", seconds: 300 },
          target: { type: "power", unit: "ftp", level: { kind: "ramp", from: 0.5, to: 0.7 } },
        },
        {
          type: "step",
          duration: { type: "time", seconds: 600 },
          target: { type: "heartRate", unit: "threshold", level: { kind: "constant", value: 0.9 } },
        },
      ],
    },
    updatedAt: at(0),
  });
  const strict = await definedError(
    client.workouts.export({ id, format: "fit" }),
    "WORKOUT_FORMAT_ERROR",
  );
  assert.deepEqual(
    strict.data.issues.map((issue) => issue.message),
    [
      "A ramp has no place in a .fit file",
      "Heart rate as a share of threshold needs a threshold heart rate to become bpm in a .fit file",
    ],
  );

  await client.settings.write({ writes: [threshold("lactate_threshold_heart_rate", 170)] });
  const loose = await client.workouts.export({ id, format: "fit", approximate: true });
  assert.deepEqual(
    loose.warnings.map((warning) => warning.code),
    ["approximated", "converted"],
  );
  const steps = flatten(parseFit(fromBase64(loose.base64)).value.steps);
  assert.equal(steps.length, 6);
  assert.deepEqual(steps[5].target, {
    type: "heartRate",
    unit: "bpm",
    level: { kind: "constant", value: 153 },
  });
});

test("a built-in workout exports as FIT", async () => {
  const client = await athlete();
  const exported = await client.builtinWorkouts.export({ id: "zone-3-3x10", format: "fit" });
  assert.equal(exported.fileName, "zone-3-3x10.fit");
  const workout = parseFit(fromBase64(exported.base64)).value;
  assert.equal(workout.name, "Zone 3 · 3×10");
  assert.equal(flatten(workout.steps).length, 8);
});

test("text exports keep their shape", async () => {
  const client = await athlete();
  const exported = await client.builtinWorkouts.export({ id: "zone-3-3x10", format: "zwo" });
  assert.equal(exported.base64, undefined);
  assert.equal(typeof exported.text, "string");
});
