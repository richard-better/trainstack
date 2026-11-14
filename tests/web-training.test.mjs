import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { thresholdPrompt } from "../hosted/apps/account/src/lib/analysis.ts";
import { timeZoneName, todayIn } from "../hosted/apps/account/src/lib/time-zone.ts";
import {
  bestsPeriod,
  formZoneOf,
  loadHistory,
  loadRange,
  loadSummary,
  signed,
} from "../hosted/apps/account/src/lib/training.ts";
import { activityFile } from "../scripts/dev-history.mjs";
import { mockApple } from "./helpers/apple.mjs";
import { migrate, rpcClient, startWorker } from "./helpers/worker.mjs";

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
  const { token } = await apple.signIn(runtime, { email: `${crypto.randomUUID()}@example.com` });
  return rpcClient(runtime, { token });
}

let clock = Date.parse("2026-11-01T00:00:00Z");
const ftp = (day, value) => ({
  day,
  change: { kind: "threshold", sport: null, threshold: "ftp", value },
  updatedAt: new Date((clock += 1000)),
});

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

const ride = (day, { seed = 1, source = "upload" } = {}) => ({
  file: new File(
    [
      activityFile({
        sport: "cycling",
        start: `${day}T17:00:00Z`,
        blocks: [{ seconds: 3600, watts: 200 }],
        seed,
      }),
    ],
    "ride.fit",
  ),
  source,
});

test("the Training page reads today's fitness, fatigue and form, counting a workout recorded twice once", async () => {
  const client = await athlete();
  await client.settings.write({ writes: [ftp("2026-01-01", 250)] });
  await client.activities.upload(ride("2026-10-20"));
  await client.activities.upload(ride("2026-10-27"));
  await client.activities.upload(ride("2026-10-27", { seed: 2, source: "strava" }));
  await runCronUntilAnalysed();

  const today = "2026-11-03";
  const range = loadRange("6w", today);
  assert.deepEqual(range, { key: "6w", label: "6 weeks", from: "2026-09-23", through: today });
  const { days } = await client.training.load({ from: range.from, through: today });
  assert.equal(days.length, 42);

  const october = days.find(({ day }) => day === "2026-10-27");
  assert.equal(october.activities.length, 1, "the copy from Strava counts once");

  const history = loadHistory(days);
  assert.equal(history.firstLoaded, "2026-10-20");
  assert.equal(history.loadedDays, 2);

  const summary = loadSummary(days, today);
  assert.equal(summary.day.day, today);
  assert.ok(summary.day.form < 0, "a week after a hard ride, fatigue is above fitness");
  assert.equal(summary.zone.key, formZoneOf(summary.day.form).key);
  const weekAgo = days.find(({ day }) => day === "2026-10-27");
  assert.ok(Math.abs(summary.ramp - (summary.day.fitness - weekAgo.fitness)) < 1e-9);
});

test("an athlete with activities but no thresholds sees no load, and what to set", async () => {
  const client = await athlete();
  await client.activities.upload(ride("2026-10-20"));
  await runCronUntilAnalysed();

  const { days } = await client.training.load({ from: "2026-10-01", through: "2026-11-01" });
  assert.equal(loadHistory(days).firstLoaded, null, "nothing to draw a flat line from");
  const { activities } = await client.activities.list({ onePerWorkout: true });
  const prompt = thresholdPrompt(activities[0], { listed: false, own: [] });
  assert.deepEqual(prompt.search, { metric: "power" });
  assert.equal(prompt.action, "Set FTP");
});

test("form is named by its zone and always carries its sign", () => {
  assert.equal(signed(12.4), "+12");
  assert.equal(signed(-0.4), "0");
  assert.equal(signed(-8.6), "-9");
  assert.deepEqual(
    [25, 10, 0, -20, -35].map((form) => formZoneOf(form).label),
    ["Very fresh", "Fresh", "Neutral", "Productive", "Overreaching"],
  );
  assert.equal(formZoneOf(5).label, "Fresh", "a zone holds from its lower edge");
});

test("bests cover this season, the last six weeks or all time, ending today", () => {
  assert.equal(bestsPeriod("season", "2026-11-14").from, "2026-01-01");
  assert.equal(bestsPeriod("six_weeks", "2026-11-14").from, "2026-10-04");
  assert.equal(bestsPeriod("all", "2026-11-14").from, "2000-01-01");
});

test("the athlete's time zone is set from the browser and decides today", async () => {
  const client = await athlete();
  assert.equal((await client.settings.get({})).timeZone, null);
  await client.settings.setTimeZone({ timeZone: "Pacific/Kiritimati" });
  assert.equal((await client.settings.get({})).timeZone, "Pacific/Kiritimati");

  const now = new Date("2026-11-14T12:00:00Z");
  assert.equal(todayIn("Pacific/Kiritimati", now), "2026-11-15");
  assert.equal(todayIn("America/Los_Angeles", now), "2026-11-14");
  assert.equal(todayIn(null, now), "2026-11-14");
  assert.equal(timeZoneName("America/New_York"), "New York");
  const { today } = await client.training.load({ from: "2026-11-01" });
  assert.equal(today, todayIn("Pacific/Kiritimati"));
});
