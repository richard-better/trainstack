import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { migrate, rpcClient, startWorker } from "./helpers/worker.mjs";
import { mockApple } from "./helpers/apple.mjs";
import { denseRide, manyLaps, pausedRun } from "./helpers/fit-files.mjs";

const SAMPLE_RIDE = "apps/ride/RideKit/Sources/RideData/Resources/SampleRide.fit";
const TRACES = "apps/ride/RideKit/Tests/RideCoreTests/Traces";
const SUMMARY_VERSION = 4;
const MAX_ACTIVITY_FILE_BYTES = 25 * 1024 * 1024;

let worker;
let runtime;
let db;
let bucket;
let rideBytes;
const apple = mockApple();

before(
  async () => {
    worker = await startWorker({ outboundService: apple.fetch });
    runtime = worker.runtime;
    await migrate(runtime);
    db = await runtime.getD1Database("DB");
    bucket = await runtime.getR2Bucket("ACTIVITY_FILES");
    rideBytes = await readFile(SAMPLE_RIDE);
  },
  { timeout: 60_000 },
);

after(async () => {
  await worker?.dispose();
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function rider() {
  const signedIn = await apple.signIn(runtime, { email: `${crypto.randomUUID()}@example.com` });
  return { ...signedIn, client: rpcClient(runtime, { token: signedIn.token }) };
}

const fitFile = (bytes = rideBytes, name = "ride.fit") => new File([bytes], name);

async function runCron() {
  const { outcome } = await (await runtime.getWorker()).scheduled({ cron: "* * * * *" });
  assert.equal(outcome, "ok");
}

async function runCronUntilNothingIsDue() {
  for (let run = 0; run < 20; run++) {
    const due = await db
      .prepare(
        "SELECT count(*) AS n FROM activity WHERE file_format IS NOT NULL AND (summary_version IS NULL OR summary_version < ?)",
      )
      .bind(SUMMARY_VERSION)
      .first();
    if (due.n === 0) return;
    await runCron();
  }
  assert.fail("activities were still due after twenty runs");
}

async function storedBeforeSummaries(userId, bytes, format = "fit") {
  const id = sha256(bytes);
  await bucket.put(`activities/${userId}/${id}`, bytes);
  await db
    .prepare(
      "INSERT INTO activity (user_id, id, source, file_format, file_size) VALUES (?, ?, 'trainstack', ?, ?)",
    )
    .bind(userId, id, format, bytes.byteLength)
    .run();
  return id;
}

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
    sport: "rowing",
    indoor: false,
    name: "Sweet spot",
    startedAt: new Date("2026-11-01T07:30:00Z"),
  });
  assert.deepEqual(uploaded.startedAt, new Date("2026-10-06T14:21:15.000Z"));
  assert.equal(uploaded.sport, "rowing");
  assert.equal(uploaded.indoor, false);
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
    assert.equal(uploaded.sport, "cycling", trace);
    assert.equal(uploaded.indoor, true, trace);
    assert.equal(uploaded.name, name, trace);
    assert.equal(uploaded.startedAt.toISOString(), startedAt, trace);
    assert.deepEqual(uploaded.statistics, statistics, trace);
    assert.equal((await client.activities.get({ id: uploaded.id })).events.length, 1, trace);
  }
});

test("a pause in the file is left out of its timer time", async () => {
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
  assert.deepEqual((await client.activities.get({ id: uploaded.id })).events, []);
});

test("an activity keeps at most two thousand events, however many laps its file has", async () => {
  const { client } = await rider();
  const uploaded = await client.activities.upload({
    file: fitFile(manyLaps(2500)),
    source: "upload",
  });
  assert.equal(uploaded.summaryError, null);
  const { events } = await client.activities.get({ id: uploaded.id });
  assert.equal(events.length, 2000);
  assert.deepEqual(events[0].startedAt, uploaded.startedAt);
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

test("GPX and TCX files are summarised the same way, a pause left out of timer time", async () => {
  const { client } = await rider();
  const fixture = (name) => readFile(`packages/activity-file/test/files/${name}`);
  const run = await client.activities.upload({
    file: new File([await fixture("garmin-connect-run.gpx")], "run.gpx"),
    source: "upload",
  });
  assert.equal(run.file.format, "gpx");
  assert.ok(run.summarizedAt instanceof Date);
  assert.equal(run.summaryError, null);
  assert.equal(run.sport, "running");
  assert.equal(run.name, "Budapest Running");
  assert.deepEqual(run.startedAt, new Date("2026-10-03T16:30:00.000Z"));
  assert.equal(run.statistics.elapsed_s, 68);
  assert.equal(run.statistics.timer_s, 8);
  assert.equal(run.statistics.max_heart_rate_bpm, 142);
  assert.deepEqual((await client.activities.get({ id: run.id })).events, []);

  const tcx = await client.activities.upload({
    file: new File([await fixture("strava-run.tcx")], "run.tcx"),
    source: "strava",
  });
  assert.equal(tcx.file.format, "tcx");
  assert.equal(tcx.summaryError, null);
  assert.equal(tcx.sport, "running");
  assert.deepEqual(tcx.statistics, {
    elapsed_s: 20,
    timer_s: 20,
    distance_m: 60,
    calories_kcal: 4,
    average_speed_mps: 3,
    average_heart_rate_bpm: 146,
    max_heart_rate_bpm: 152,
    average_cadence_rpm: 86,
    max_cadence_rpm: 88,
    ascent_m: 0,
    descent_m: 0,
  });
  assert.equal((await client.activities.get({ id: tcx.id })).events[0].type, "lap");

  const empty = await client.activities.upload({
    file: new File(
      ['<?xml version="1.0"?><gpx version="1.1"><trk><trkseg/></trk></gpx>'],
      "empty.gpx",
    ),
    source: "upload",
  });
  assert.equal(empty.summaryError, "no_activity");
  assert.equal(empty.summarizedAt, null);
});

test("activities stored before summaries existed are summarised by the scheduled pass", async () => {
  const { client, user } = await rider();
  const id = await storedBeforeSummaries(user.id, rideBytes);
  const before = await client.activities.get({ id });
  assert.equal(before.summarizedAt, null);
  assert.deepEqual(before.statistics, {});

  await runCronUntilNothingIsDue();
  const after = await client.activities.get({ id });
  assert.ok(after.summarizedAt instanceof Date);
  assert.deepEqual(after.statistics, sampleRideStatistics);
  assert.equal(after.events.length, 10);
});

test("an activity summarised by older logic is summarised again, replacing what it had", async () => {
  const { client, user } = await rider();
  const { id } = await client.activities.upload({ file: fitFile(), source: "trainstack" });
  await db.batch([
    db
      .prepare(
        "UPDATE activity SET summary_version = 0, file_sport = 'stale' WHERE user_id = ? AND id = ?",
      )
      .bind(user.id, id),
    db
      .prepare(
        "INSERT INTO activity_statistic (user_id, activity_id, name, value) VALUES (?, ?, 'old_name_s', 1)",
      )
      .bind(user.id, id),
  ]);
  assert.equal((await client.activities.get({ id })).sport, "stale");

  for (let run = 0; run < 20; run++) {
    const row = await db
      .prepare("SELECT summary_version FROM activity WHERE user_id = ? AND id = ?")
      .bind(user.id, id)
      .first();
    if (row.summary_version > 0) break;
    await runCron();
  }
  const resummarised = await client.activities.get({ id });
  assert.equal(resummarised.sport, "cycling");
  assert.deepEqual(resummarised.statistics, sampleRideStatistics);
  assert.equal(resummarised.events.length, 10);
});

test("a file at the upload limit is summarised, and one the 2 MB limit left too large is summarised again", async () => {
  const { client, user } = await rider();
  const full = denseRide(MAX_ACTIVITY_FILE_BYTES - 1024);
  const uploaded = await client.activities.upload({ file: fitFile(full), source: "upload" });
  assert.equal(uploaded.summaryError, null);
  assert.ok(uploaded.summarizedAt instanceof Date);
  assert.equal(uploaded.statistics.max_power_w, 249);

  await runCronUntilNothingIsDue();
  const leftTooLarge = await storedBeforeSummaries(
    user.id,
    denseRide(3 * 1024 * 1024, "2026-05-05T05:00:00Z"),
  );
  await db
    .prepare(
      "UPDATE activity SET summary_version = 1, summary_error = 'too_large' WHERE user_id = ? AND id = ?",
    )
    .bind(user.id, leftTooLarge)
    .run();
  await runCronUntilNothingIsDue();
  const summarised = await client.activities.get({ id: leftTooLarge });
  assert.equal(summarised.summaryError, null);
  assert.ok(summarised.summarizedAt instanceof Date);
});

test("a file with more laps than an activity can have says so, and is not retried", async () => {
  const { client, user } = await rider();
  const uploaded = await client.activities.upload({
    file: fitFile(manyLaps(10_001)),
    source: "upload",
  });
  assert.equal(uploaded.summaryError, "too_large");
  assert.equal(uploaded.summarizedAt, null);
  await runCron();
  const row = await db
    .prepare("SELECT summary_version, summary_attempts FROM activity WHERE user_id = ? AND id = ?")
    .bind(user.id, uploaded.id)
    .first();
  assert.deepEqual(row, { summary_version: SUMMARY_VERSION, summary_attempts: 0 });
});

test("a summary that keeps dying is retried a bounded number of times, then reported as failed", async () => {
  const { client, user } = await rider();
  await runCronUntilNothingIsDue();
  const dying = await storedBeforeSummaries(user.id, denseRide(10_000, "2026-08-02T06:00:00Z"));
  await bucket.delete(`activities/${user.id}/${dying}`);

  for (let run = 1; run <= 3; run++) {
    await runCron();
    const row = await db
      .prepare("SELECT summary_attempts, summary_error FROM activity WHERE user_id = ? AND id = ?")
      .bind(user.id, dying)
      .first();
    assert.deepEqual(row, { summary_attempts: run, summary_error: null });
    assert.equal((await client.activities.get({ id: dying })).summaryError, null);
  }
  await runCron();
  const failed = await client.activities.get({ id: dying });
  assert.equal(failed.summaryError, "failed");
  assert.equal(failed.summarizedAt, null);

  await runCron();
  const row = await db
    .prepare("SELECT summary_attempts FROM activity WHERE user_id = ? AND id = ?")
    .bind(user.id, dying)
    .first();
  assert.equal(row.summary_attempts, 0);
});

test("each scheduled run takes a small batch, and a file that dies goes to the back", async () => {
  const { user } = await rider();
  await runCronUntilNothingIsDue();
  const dying = await storedBeforeSummaries(user.id, denseRide(10_000, "2026-07-01T00:00:00Z"));
  await bucket.delete(`activities/${user.id}/${dying}`);
  const healthy = [];
  for (let day = 1; day <= 6; day++) {
    healthy.push(
      await storedBeforeSummaries(
        user.id,
        denseRide(5_000, `2026-07-${String(day + 1).padStart(2, "0")}T00:00:00Z`),
      ),
    );
  }

  const summarised = async () =>
    (
      await db
        .prepare(
          "SELECT count(*) AS n FROM activity WHERE user_id = ? AND summarized_at IS NOT NULL",
        )
        .bind(user.id)
        .first()
    ).n;
  await runCron();
  assert.equal(await summarised(), 4);
  await runCron();
  assert.equal(await summarised(), 6);
});

test("a scheduled run working from a stale view does not overwrite a newer outcome", async () => {
  const { client, user } = await rider();
  await runCronUntilNothingIsDue();
  const first = await storedBeforeSummaries(user.id, denseRide(5_000, "2026-06-01T00:00:00Z"));
  const exhausted = await storedBeforeSummaries(user.id, denseRide(5_000, "2026-06-02T00:00:00Z"));
  await db
    .prepare("UPDATE activity SET summary_attempts = 3 WHERE user_id = ? AND id = ?")
    .bind(user.id, exhausted)
    .run();
  await db
    .prepare(
      `CREATE TRIGGER another_run_finishes_first AFTER UPDATE OF summary_attempts ON activity
       WHEN NEW.id = '${first}' AND NEW.summary_attempts = 1
       BEGIN
         UPDATE activity SET summary_attempts = 0, summary_version = 2, summarized_at = 1
           WHERE user_id = NEW.user_id AND id = '${exhausted}';
         INSERT INTO activity_statistic (user_id, activity_id, name, value)
           VALUES (NEW.user_id, '${exhausted}', 'elapsed_s', 42);
       END`,
    )
    .run();
  try {
    await runCron();
  } finally {
    await db.prepare("DROP TRIGGER another_run_finishes_first").run();
  }
  const kept = await client.activities.get({ id: exhausted });
  assert.equal(kept.summaryError, null);
  assert.deepEqual(kept.statistics, { elapsed_s: 42 });
  assert.ok((await client.activities.get({ id: first })).summarizedAt instanceof Date);
});
