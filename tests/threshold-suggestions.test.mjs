import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { migrate, rpcClient, startWorker } from "./helpers/worker.mjs";
import { mockApple } from "./helpers/apple.mjs";
import { effortRide } from "./helpers/fit-files.mjs";

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

const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const put = (day, change) => ({ day, change, updatedAt: new Date() });
const threshold = (name, value) => ({ kind: "threshold", sport: null, threshold: name, value });
const withMaxHeartRate = (client) =>
  client.settings.write({ writes: [put("2026-01-01", threshold("max_heart_rate", 190))] });

const easy = (seconds) => ({ seconds, power: 130, heartRate: 125 });
const testRide = (day, scale = 1) =>
  new File(
    [
      effortRide({
        start: `${day}T06:00:00Z`,
        blocks: [
          easy(900),
          { seconds: 300, power: Math.round(330 * scale), heartRate: 182 },
          easy(600),
          { seconds: 600, power: Math.round(298 * scale), heartRate: 178 },
          easy(600),
          { seconds: 1200, power: Math.round(283 * scale), heartRate: 175 },
          easy(600),
        ],
      }),
    ],
    "ride.fit",
  );

async function runCronUntilDetected() {
  for (let run = 0; run < 30; run++) {
    const { n } = await db
      .prepare(
        `SELECT (SELECT count(*) FROM activity_analysis WHERE due = 1 OR version < 4)
              + (SELECT count(*) FROM activity WHERE file_format IS NOT NULL AND summary_version IS NULL) AS n`,
      )
      .first();
    const { outcome } = await (await runtime.getWorker()).scheduled({ cron: "* * * * *" });
    assert.equal(outcome, "ok");
    if (n === 0) return;
  }
  assert.fail("activities were still due after thirty runs");
}

test("a season's test ride suggests an FTP with its evidence, and accepting it from the effort's day sets it with a detected test", async () => {
  const { client } = await athlete();
  await withMaxHeartRate(client);
  const day = daysAgo(10);
  const { id: activityId } = await client.activities.upload({
    file: testRide(day),
    source: "upload",
  });
  await runCronUntilDetected();

  const { suggestions } = await client.thresholds.suggestions({});
  assert.equal(suggestions.length, 1, JSON.stringify(suggestions));
  const [ftp] = suggestions;
  assert.equal(ftp.threshold, "ftp");
  assert.equal(ftp.sport, null);
  assert.equal(ftp.value, 259);
  assert.equal(ftp.current, null);
  assert.equal(ftp.method, "critical_power");
  assert.equal(ftp.confidence, "high");
  assert.equal(ftp.activityId, activityId);
  assert.equal(ftp.effortDay, day);
  assert.deepEqual(
    ftp.evidence.map(({ statistic, value }) => [statistic, value]),
    [
      ["best_power_300s_w", 330],
      ["best_power_600s_w", 298],
      ["best_power_1200s_w", 283],
      ["best_power_1200s_heart_rate_bpm", 175],
    ],
  );

  const accepted = await client.thresholds.accept({ id: ftp.id, from: "effort" });
  assert.equal(accepted.day, day);
  const { entries } = await client.settings.history({});
  const written = entries.filter((entry) => entry.day === day).map(({ change }) => change);
  assert.deepEqual(written, [
    { kind: "threshold", sport: null, threshold: "ftp", value: 259 },
    {
      kind: "threshold_test",
      id: accepted.testId,
      sport: null,
      threshold: "ftp",
      protocol: "detected",
      value: 259,
      activityId,
    },
  ]);
  assert.equal((await client.settings.get({})).defaults.power.thresholds.ftp, 259);
  assert.deepEqual((await client.thresholds.suggestions({})).suggestions, []);

  await runCronUntilDetected();
  assert.deepEqual((await client.thresholds.suggestions({})).suggestions, []);
  await assert.rejects(
    client.thresholds.accept({ id: ftp.id, from: "today" }),
    /NOT_FOUND|suggestion/,
  );
});

test("accepting from the effort's day sets up the sport there when it was set up later", async () => {
  const { client } = await athlete();
  const today = daysAgo(0);
  await client.settings.write({
    writes: [
      put("2026-01-01", threshold("max_heart_rate", 190)),
      put(today, { kind: "sport", sport: "cycling", listed: true }),
      put(today, { kind: "own_zones", sport: "cycling", metric: "power", own: true }),
    ],
  });
  const day = daysAgo(10);
  await client.activities.upload({ file: testRide(day), source: "upload" });
  await runCronUntilDetected();
  const [ftp] = (await client.thresholds.suggestions({})).suggestions;
  assert.equal(ftp.sport, "cycling");
  await client.thresholds.accept({ id: ftp.id, from: "effort" });
  const onTheDay = await client.settings.get({ day });
  assert.equal(onTheDay.sports.cycling.power.thresholds.ftp, 259);
  assert.equal(onTheDay.sports.cycling.power.usesDefault, false);
  assert.equal((await client.settings.get({})).sports.cycling.power.thresholds.ftp, 259);
});

test("accepting from today dates the threshold today", async () => {
  const { client } = await athlete();
  await withMaxHeartRate(client);
  await client.activities.upload({ file: testRide(daysAgo(20)), source: "upload" });
  await runCronUntilDetected();
  const [ftp] = (await client.thresholds.suggestions({})).suggestions;
  const { day } = await client.thresholds.accept({ id: ftp.id, from: "today" });
  const settings = await client.settings.get({});
  assert.equal(settings.defaults.power.thresholds.ftp, 259);
  assert.equal(
    (await client.settings.get({ day: daysAgo(20) })).defaults.power.thresholds.ftp,
    undefined,
  );
  assert.ok(day >= daysAgo(1));
});

test("a dismissed suggestion stays away for the same evidence and comes back for a better effort", async () => {
  const { client } = await athlete();
  await withMaxHeartRate(client);
  await client.activities.upload({ file: testRide(daysAgo(30)), source: "upload" });
  await runCronUntilDetected();
  const [ftp] = (await client.thresholds.suggestions({})).suggestions;
  await client.thresholds.dismiss({ id: ftp.id });
  assert.deepEqual((await client.thresholds.suggestions({})).suggestions, []);

  await client.settings.write({ writes: [put("2026-01-01", { kind: "weight", kg: 70 })] });
  await runCronUntilDetected();
  assert.deepEqual((await client.thresholds.suggestions({})).suggestions, []);

  await client.activities.upload({ file: testRide(daysAgo(5), 1.05), source: "upload" });
  await runCronUntilDetected();
  const [better] = (await client.thresholds.suggestions({})).suggestions;
  assert.equal(better.threshold, "ftp");
  assert.ok(better.value > ftp.value);
  assert.notEqual(better.id, ftp.id);
});

test("a threshold close to what is set is not suggested, and one far from it is, with what is set", async () => {
  const { client } = await athlete();
  await client.settings.write({
    writes: [
      put("2026-01-01", threshold("max_heart_rate", 190)),
      put("2026-01-01", threshold("ftp", 255)),
    ],
  });
  await client.activities.upload({ file: testRide(daysAgo(10)), source: "upload" });
  await runCronUntilDetected();
  assert.deepEqual((await client.thresholds.suggestions({})).suggestions, []);

  await client.settings.write({ writes: [put("2026-01-02", threshold("ftp", 230))] });
  await runCronUntilDetected();
  const [ftp] = (await client.thresholds.suggestions({})).suggestions;
  assert.equal(ftp.value, 259);
  assert.equal(ftp.current, 230);
});

test("nothing changes an athlete's thresholds without their say", async () => {
  const { client } = await athlete();
  await withMaxHeartRate(client);
  await client.activities.upload({ file: testRide(daysAgo(10)), source: "upload" });
  await runCronUntilDetected();
  assert.equal((await client.thresholds.suggestions({})).suggestions.length, 1);
  assert.equal((await client.settings.get({})).defaults.power.thresholds.ftp, undefined);
});

test("another athlete's suggestion cannot be accepted or dismissed", async () => {
  const owner = await athlete();
  await withMaxHeartRate(owner.client);
  await owner.client.activities.upload({ file: testRide(daysAgo(10)), source: "upload" });
  await runCronUntilDetected();
  const [ftp] = (await owner.client.thresholds.suggestions({})).suggestions;
  const other = await athlete();
  await assert.rejects(other.client.thresholds.accept({ id: ftp.id, from: "today" }));
  await assert.rejects(other.client.thresholds.dismiss({ id: ftp.id }));
  assert.equal((await owner.client.thresholds.suggestions({})).suggestions.length, 1);
});
