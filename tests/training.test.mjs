import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { migrate, rpcClient, startWorker } from "./helpers/worker.mjs";
import { mockApple } from "./helpers/apple.mjs";
import { denseRide } from "./helpers/fit-files.mjs";

let worker;
let runtime;
let db;
const apple = mockApple();

before(
  async () => {
    worker = await startWorker({ outboundService: apple.fetch });
    runtime = worker.runtime;
    await migrate(runtime);
    db = await runtime.getD1Database("DB");
  },
  { timeout: 60_000 },
);

after(async () => {
  await worker?.dispose();
});

async function athlete() {
  const signedIn = await apple.signIn(runtime, { email: `${crypto.randomUUID()}@example.com` });
  return { ...signedIn, client: rpcClient(runtime, { token: signedIn.token }) };
}

let clock = Date.parse("2026-11-01T00:00:00Z");
const put = (day, change) => ({ day, change, updatedAt: new Date((clock += 1000)) });
const ftp = (value) => ({ kind: "threshold", sport: null, threshold: "ftp", value });

async function runCronUntilAnalysed() {
  for (let run = 0; run < 30; run++) {
    const { n } = await db
      .prepare(
        `SELECT (SELECT count(*) FROM activity_analysis WHERE due = 1 OR version < 1)
              + (SELECT count(*) FROM activity WHERE file_format IS NOT NULL AND summary_version IS NULL) AS n`,
      )
      .first();
    if (n === 0) return;
    const { outcome } = await (await runtime.getWorker()).scheduled({ cron: "* * * * *" });
    assert.equal(outcome, "ok");
  }
  assert.fail("activities were still due after thirty runs");
}

const ride = (start, bytes = 60_000) =>
  new File([denseRide(bytes, `${start}T06:00:00Z`)], "ride.fit");

const dayOf = (days, day) => days.find((entry) => entry.day === day);

test("the load counts each day's rides with the thresholds of their day, and follows a correction", async () => {
  const { client } = await athlete();
  await client.settings.write({ writes: [put("2026-01-01", ftp(200))] });
  const march = await client.activities.upload({ file: ride("2026-03-02"), source: "upload" });
  const april = await client.activities.upload({ file: ride("2026-04-01"), source: "upload" });
  await runCronUntilAnalysed();

  const before = await client.training.load({ from: "2026-03-01", through: "2026-04-03" });
  assert.equal(before.days.length, 34);
  assert.equal(before.days[0].day, "2026-03-01");
  assert.deepEqual(dayOf(before.days, "2026-03-01"), {
    day: "2026-03-01",
    stress: 0,
    fitness: 0,
    fatigue: 0,
    form: 0,
    activities: [],
  });
  const marchStress = (await client.activities.get({ id: march.id })).statistics.load_tss;
  assert.ok(marchStress > 0);
  const marchDay = dayOf(before.days, "2026-03-02");
  assert.deepEqual(marchDay.activities, [{ id: march.id, stress: marchStress, source: "power" }]);
  assert.equal(marchDay.stress, marchStress);
  assert.ok(Math.abs(marchDay.fitness - marchStress / 42) < 1e-9);
  assert.ok(Math.abs(marchDay.fatigue - marchStress / 7) < 1e-9);
  assert.ok(Math.abs(marchDay.form - (marchDay.fitness - marchDay.fatigue)) < 1e-9);
  assert.ok(dayOf(before.days, "2026-03-03").fitness < marchDay.fitness);

  const later = await client.training.load({ from: "2026-04-01", through: "2026-04-01" });
  assert.deepEqual(later.days[0], dayOf(before.days, "2026-04-01"));

  await client.settings.write({ writes: [put("2026-03-01", ftp(300))] });
  await runCronUntilAnalysed();
  const corrected = await client.training.load({ from: "2026-03-01", through: "2026-04-03" });
  const correctedMarch = dayOf(corrected.days, "2026-03-02");
  assert.ok(correctedMarch.stress < marchDay.stress);
  assert.ok(
    Math.abs(correctedMarch.stress - marchDay.stress * (200 / 300) ** 2) < 1,
    `${correctedMarch.stress} vs ${marchDay.stress}`,
  );
  assert.ok(dayOf(corrected.days, "2026-04-03").fitness < dayOf(before.days, "2026-04-03").fitness);
  assert.deepEqual(
    dayOf(corrected.days, "2026-04-01").activities.map(({ id }) => id),
    [april.id],
  );
});

test("a workout recorded twice counts once, and a deleted activity leaves the load", async () => {
  const { client } = await athlete();
  await client.settings.write({ writes: [put("2026-01-01", ftp(250))] });
  const first = await client.activities.upload({
    file: ride("2026-05-05", 60_000),
    source: "upload",
  });
  const copy = await client.activities.upload({
    file: ride("2026-05-05", 62_000),
    source: "strava",
  });
  const other = await client.activities.upload({ file: ride("2026-05-06"), source: "upload" });
  await runCronUntilAnalysed();
  const workout = await client.activities.get({ id: first.id });
  assert.equal(workout.duplicates.length, 1);
  const primary = workout.primary ? first.id : copy.id;

  const load = await client.training.load({ from: "2026-05-05", through: "2026-05-06" });
  assert.deepEqual(
    load.days[0].activities.map(({ id }) => id),
    [primary],
  );

  await client.activities.delete({ id: other.id });
  const afterDelete = await client.training.load({ from: "2026-05-05", through: "2026-05-06" });
  assert.equal(afterDelete.days[1].stress, 0);
  assert.deepEqual(afterDelete.days[1].activities, []);
  assert.ok(afterDelete.days[1].fitness < load.days[1].fitness);
});

test("bests come from the best activity of the period, one per workout, by sport", async () => {
  const { client } = await athlete();
  const easy = await client.activities.upload({
    file: ride("2026-06-01", 30_000),
    source: "upload",
  });
  const long = await client.activities.upload({
    file: ride("2026-06-10", 200_000),
    source: "upload",
  });
  await runCronUntilAnalysed();
  await db
    .prepare(
      "UPDATE activity_statistic SET value = 400 WHERE activity_id = ? AND name = 'best_power_5s_w'",
    )
    .bind(easy.id)
    .run();

  const june = await client.training.bests({ from: "2026-06-01", through: "2026-06-30" });
  assert.deepEqual(june.powerCurve[0], {
    durationSeconds: 5,
    watts: 400,
    activityId: easy.id,
    day: "2026-06-01",
  });
  const fiveMinutes = june.powerCurve.find(({ durationSeconds }) => durationSeconds === 300);
  assert.equal(fiveMinutes.activityId, long.id);
  const durations = june.powerCurve.map(({ durationSeconds }) => durationSeconds);
  assert.deepEqual(
    durations,
    durations.toSorted((a, b) => a - b),
  );
  assert.deepEqual(june.bestEfforts, []);

  const later = await client.training.bests({ from: "2026-06-02", through: "2026-06-30" });
  assert.equal(later.powerCurve[0].activityId, long.id);
  const running = await client.training.bests({
    from: "2026-06-01",
    through: "2026-06-30",
    sport: "running",
  });
  assert.deepEqual(running, { powerCurve: [], bestEfforts: [] });
});

test("today ends where the athlete's time zone says, and long or reversed ranges are refused", async () => {
  const { client } = await athlete();
  await client.settings.setTimeZone({ timeZone: "Pacific/Kiritimati" });
  const { today, days } = await client.training.load({ from: "2026-01-01" });
  const expected = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati" }).format(
    new Date(),
  );
  assert.equal(today, expected);
  assert.equal(days.at(-1).day, expected);
  await assert.rejects(client.training.load({ from: "2026-02-01", through: "2026-01-01" }), {
    code: "BAD_REQUEST",
  });
  await assert.rejects(client.training.load({ from: "2020-01-01", through: "2026-01-01" }), {
    code: "BAD_REQUEST",
  });
  await assert.rejects(client.training.load({ from: "2020-01-01" }), { code: "BAD_REQUEST" });
});

test("the load and bests read the athlete's statistics by name through their index", async () => {
  for (const query of [
    "SELECT activity_id, value FROM activity_statistic WHERE user_id = ? AND name = 'load_tss'",
    "SELECT activity_id, value FROM activity_statistic WHERE user_id = ? AND name >= 'best_power_' AND name < 'best_power_\u{10ffff}' AND name GLOB 'best_power_*s_w'",
  ]) {
    const plan = await db.prepare(`EXPLAIN QUERY PLAN ${query}`).bind("someone").all();
    assert.match(
      plan.results.map((row) => row.detail).join("\n"),
      /USING (COVERING )?INDEX activity_statistic_user_name_idx \(user_id=\? AND name/,
    );
  }
});
