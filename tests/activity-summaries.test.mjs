import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { migrate, rpcClient, startWorker } from "./helpers/worker.mjs";
import { mockApple } from "./helpers/apple.mjs";
import { pausedRun } from "./helpers/fit-files.mjs";

const SAMPLE_RIDE = "apps/ride/RideKit/Sources/RideData/Resources/SampleRide.fit";
const TRACES = "apps/ride/RideKit/Tests/RideCoreTests/Traces";

let worker;
let runtime;
let rideBytes;
const apple = mockApple();

before(
  async () => {
    worker = await startWorker({ outboundService: apple.fetch });
    runtime = worker.runtime;
    await migrate(runtime);
    rideBytes = await readFile(SAMPLE_RIDE);
  },
  { timeout: 60_000 },
);

after(async () => {
  await worker?.dispose();
});

async function rider() {
  const signedIn = await apple.signIn(runtime, { email: `${crypto.randomUUID()}@example.com` });
  return { ...signedIn, client: rpcClient(runtime, { token: signedIn.token }) };
}

const fitFile = (bytes = rideBytes, name = "ride.fit") => new File([bytes], name);

const sampleRideStatistics = {
  elapsed_s: 1800,
  timer_s: 1800,
  distance_m: 14389,
  calories_kcal: 247,
  average_speed_mps: 7.993,
  max_speed_mps: 8.576,
  average_heart_rate_bpm: 146,
  max_heart_rate_bpm: 167,
  average_cadence_rpm: 70,
  max_cadence_rpm: 91,
  average_power_w: 137,
  max_power_w: 177,
};

test("an uploaded FIT file comes back summarised, with its laps as events", async () => {
  const { client } = await rider();
  const uploaded = await client.activities.upload({ file: fitFile(), source: "trainstack" });
  assert.ok(uploaded.summarizedAt instanceof Date);
  assert.equal(uploaded.summaryError, null);
  assert.deepEqual(uploaded.startedAt, new Date("2026-10-06T14:21:15.000Z"));
  assert.equal(uploaded.sport, "cycling");
  assert.equal(uploaded.name, null);
  assert.deepEqual(uploaded.statistics, sampleRideStatistics);

  const detail = await client.activities.get({ id: uploaded.id });
  assert.deepEqual({ ...detail, events: undefined }, { ...uploaded, events: undefined });
  assert.equal(detail.events.length, 10);
  assert.ok(detail.events.every((event) => event.type === "lap"));
  assert.deepEqual(detail.events[0], {
    type: "lap",
    startedAt: new Date("2026-10-06T14:21:15.000Z"),
    endedAt: new Date("2026-10-06T14:24:15.000Z"),
    data: {
      elapsed_s: 180,
      timer_s: 180,
      distance_m: 1336.85,
      calories_kcal: 21,
      average_speed_mps: 7.426,
      max_speed_mps: 8.081,
      average_heart_rate_bpm: 120,
      max_heart_rate_bpm: 134,
      average_cadence_rpm: 68,
      max_cadence_rpm: 85,
      average_power_w: 114,
      max_power_w: 139,
      trigger: "manual",
    },
  });
  assert.equal(detail.events.at(-1).data.trigger, "session_end");
  assert.deepEqual((await client.activities.list({})).activities, [uploaded]);
});

test("the file's start time wins over the client's, and the client's sport and name win over the file's", async () => {
  const { client } = await rider();
  const uploaded = await client.activities.upload({
    file: fitFile(),
    source: "trainstack",
    sport: "indoor_cycling",
    name: "Sweet spot",
    startedAt: new Date("2026-11-01T07:30:00Z"),
  });
  assert.deepEqual(uploaded.startedAt, new Date("2026-10-06T14:21:15.000Z"));
  assert.equal(uploaded.sport, "indoor_cycling");
  assert.equal(uploaded.name, "Sweet spot");
});

test("Ride's golden files summarise as indoor cycling, named after their workout", async () => {
  const { client } = await rider();
  const expected = {
    "quick-test-trainer-drop": {
      name: "Quick test 45s",
      startedAt: "2027-01-15T08:00:00.000Z",
      statistics: {
        elapsed_s: 45,
        timer_s: 45,
        distance_m: 305.2,
        average_speed_mps: 6.8868222222222215,
        max_speed_mps: 10.073,
        average_heart_rate_bpm: 108,
        max_heart_rate_bpm: 144,
        average_cadence_rpm: 90,
        max_cadence_rpm: 93,
        average_power_w: 204,
        max_power_w: 305,
      },
    },
    "recovery-every-control": {
      name: "Recovery 10",
      startedAt: "2027-01-15T08:00:00.000Z",
      statistics: {
        elapsed_s: 550,
        timer_s: 550,
        distance_m: 3596.22,
        average_speed_mps: 6.544767272727275,
        max_speed_mps: 8.375,
        average_heart_rate_bpm: 138,
        max_heart_rate_bpm: 158,
        average_cadence_rpm: 90,
        max_cadence_rpm: 93,
        average_power_w: 141,
        max_power_w: 179,
      },
    },
    "trainer-and-strap": {
      name: "Quick test 45s",
      startedAt: "2026-10-29T20:53:20.000Z",
      statistics: {
        elapsed_s: 50,
        timer_s: 50,
        distance_m: 331.11,
        average_speed_mps: 6.698879999999998,
        max_speed_mps: 8.489,
        average_cadence_rpm: 88,
        max_cadence_rpm: 91,
        average_power_w: 148,
        max_power_w: 222,
      },
    },
  };
  for (const [trace, { name, startedAt, statistics }] of Object.entries(expected)) {
    const bytes = await readFile(`${TRACES}/${trace}.fit`);
    const uploaded = await client.activities.upload({
      file: fitFile(bytes, `${trace}.fit`),
      source: "trainstack",
    });
    assert.equal(uploaded.sport, "indoor_cycling", trace);
    assert.equal(uploaded.name, name, trace);
    assert.equal(uploaded.startedAt.toISOString(), startedAt, trace);
    assert.deepEqual(uploaded.statistics, statistics, trace);
    assert.equal((await client.activities.get({ id: uploaded.id })).events.length, 1, trace);
  }
});

test("a pause in the file becomes a pause event between its laps", async () => {
  const { client } = await rider();
  const uploaded = await client.activities.upload({ file: fitFile(pausedRun()), source: "upload" });
  assert.equal(uploaded.sport, "running");
  assert.deepEqual(uploaded.statistics, {
    elapsed_s: 1200,
    timer_s: 1140,
    distance_m: 3000,
    average_heart_rate_bpm: 154,
    max_heart_rate_bpm: 165,
  });
  const { events } = await client.activities.get({ id: uploaded.id });
  assert.deepEqual(events, [
    {
      type: "pause",
      startedAt: new Date("2026-09-01T06:10:00Z"),
      endedAt: new Date("2026-09-01T06:11:00Z"),
      data: {},
    },
  ]);
});

test("a FIT file that will not decode stays stored, listed and downloadable, with the reason", async () => {
  const { client } = await rider();
  const truncated = new Uint8Array(rideBytes.subarray(0, 4000));
  const corrupt = new Uint8Array(rideBytes);
  corrupt[corrupt.length - 1] ^= 0xff;
  for (const [bytes, reason] of [
    [truncated, "truncated"],
    [corrupt, "corrupt"],
  ]) {
    const uploaded = await client.activities.upload({
      file: fitFile(bytes),
      source: "upload",
      sport: "cycling",
      startedAt: new Date("2026-02-02T08:00:00Z"),
    });
    assert.equal(uploaded.summaryError, reason);
    assert.equal(uploaded.summarizedAt, null);
    assert.deepEqual(uploaded.statistics, {});
    assert.deepEqual(uploaded.startedAt, new Date("2026-02-02T08:00:00Z"));
    assert.equal(uploaded.sport, "cycling");
    const file = await client.activities.file({ id: uploaded.id });
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
    assert.deepEqual((await client.activities.get({ id: uploaded.id })).summaryError, reason);
  }
  assert.equal((await client.activities.list({})).activities.length, 2);
});
