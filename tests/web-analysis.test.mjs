import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { activityStatistics, analysisStatistics } from "@trainstack/contract";
import { activityWeeks } from "../hosted/apps/account/src/lib/activity-weeks.ts";
import {
  activityBestEfforts,
  activityPowerCurve,
  analysisState,
  analysisUpdating,
  anyAnalysisDue,
  effortFigures,
  lapsFromEvents,
  loadOf,
  thresholdPrompt,
} from "../hosted/apps/account/src/lib/analysis.ts";
import { mondayOf, weekLabel } from "../hosted/apps/account/src/lib/dates.ts";
import { figureOf, summaryFigures } from "../hosted/apps/account/src/lib/statistics.ts";
import { storedShares } from "../hosted/apps/account/src/lib/activity-zones.ts";
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
const threshold = (day, name, value, sport = null) => ({
  day,
  change: { kind: "threshold", sport, threshold: name, value },
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

const defaultsOnly = { listed: false, own: [] };

const intervals = (ftp) => [
  { seconds: 600, watts: 0.6 * ftp },
  { seconds: 600, watts: ftp },
  { seconds: 300, watts: 0.5 * ftp },
];

const ride = (start, { ftp = 250, seed = 1, source = "upload" } = {}) => ({
  file: new File(
    [activityFile({ sport: "cycling", start, blocks: intervals(ftp), seed })],
    "ride.fit",
  ),
  source,
});

const run = (start) => ({
  file: new File(
    [activityFile({ sport: "running", start, blocks: [{ seconds: 1500, speed: 3.6 }], seed: 7 })],
    "run.fit",
  ),
  source: "upload",
});

test("activity detail reads its load, intensity, laps, power curve and zones from the server", async () => {
  const client = await athlete();
  await client.settings.write({ writes: [threshold("2026-01-01", "ftp", 250)] });
  const { id } = await client.activities.upload(ride("2026-03-02T17:00:00Z"));

  const fresh = await client.activities.get({ id });
  assert.deepEqual(analysisState(fresh), { kind: "pending" });

  await runCronUntilAnalysed();
  const activity = await client.activities.get({ id });
  assert.deepEqual(analysisState(activity), { kind: "analysed" });
  assert.deepEqual(loadOf(activity.statistics, "cycling"), {
    stress: activity.statistics.load_tss,
    source: "power",
  });
  assert.deepEqual(
    effortFigures(activity.statistics, "cycling").map(({ label }) => label),
    ["Load", "Intensity", "Normalized power", "Work"],
  );
  assert.equal(thresholdPrompt({ ...activity, sport: "cycling" }, defaultsOnly), null);

  const labels = summaryFigures(activity.statistics).map(({ label }) => label);
  assert.ok(labels.includes("Avg power"));
  assert.ok(
    !labels.some((label) => /zone|Best|Load|Normalized/.test(label)),
    `the summary leaves analysis numbers to their own sections: ${labels}`,
  );

  const laps = lapsFromEvents(activity.events, activity.startedAt);
  assert.deepEqual(
    laps.map(({ seconds }) => seconds),
    [600, 600, 300],
  );
  assert.ok(laps[1].normalizedPower > laps[0].normalizedPower);
  assert.ok(laps.every((lap) => lap.workKilojoules > 0));

  const curve = activityPowerCurve(activity.statistics);
  assert.deepEqual(
    curve.map(({ durationSeconds }) => durationSeconds),
    [5, 15, 30, 60, 300, 600, 1200],
  );
  assert.ok(curve.every(({ watts }, index) => index === 0 || watts <= curve[index - 1].watts));
  assert.deepEqual(activityBestEfforts(activity.statistics), []);

  const { zones } = await client.settings.zones({ day: activity.localDay, sport: "cycling" });
  const shares = storedShares(activity.statistics, { ...zones.power });
  assert.equal(shares.length, zones.power.zones.length);
  const inZones = shares.reduce((sum, { seconds }) => sum + seconds, 0);
  assert.ok(Math.abs(inZones - activity.statistics.timer_s) <= 1, `${inZones} s in zones`);
  assert.ok(shares.find(({ zone }) => zone.label === "4").seconds > 300);
});

test("a run without its threshold pace says its load is from heart rate and links to pace", async () => {
  const client = await athlete();
  await client.settings.write({
    writes: [
      threshold("2026-01-01", "lactate_threshold_heart_rate", 170),
      threshold("2026-01-01", "max_heart_rate", 190),
      threshold("2026-01-01", "resting_heart_rate", 50),
    ],
  });
  const { id } = await client.activities.upload(run("2026-04-04T07:00:00Z"));
  await runCronUntilAnalysed();
  const activity = await client.activities.get({ id });

  assert.deepEqual(activity.missingThresholds, ["threshold_pace"]);
  assert.equal(loadOf(activity.statistics, "running").source, "heart_rate");
  const unlisted = thresholdPrompt(activity, defaultsOnly);
  assert.deepEqual(unlisted.search, {}, "pace is set on running, which is not in Settings yet");
  assert.equal(unlisted.action, "Add running");
  assert.match(unlisted.text, /load is from heart rate/);
  assert.match(unlisted.text, /threshold pace was not set on 4 Apr 2026/);
  assert.match(unlisted.text, /Add running in Settings, then set its threshold pace/);

  const listed = thresholdPrompt(activity, { listed: true, own: ["pace"] });
  assert.deepEqual(listed.search, { sport: "running", metric: "pace" });
  assert.equal(listed.action, "Set threshold pace");
  assert.match(listed.text, /score it from pace instead/);

  const figures = effortFigures(activity.statistics, "running");
  const pace = figures.find(({ name }) => name === "average_grade_adjusted_speed_mps");
  assert.equal(pace.label, "Grade-adjusted pace");
  assert.equal(pace.unit, "/km");
  assert.match(pace.value, /^\d:\d\d$/);
  assert.ok(activityBestEfforts(activity.statistics).some(({ name }) => name === "5km"));
});

test("a ride with no FTP has no load, and is told to set it from its day", async () => {
  const client = await athlete();
  const { id } = await client.activities.upload(ride("2026-05-05T17:00:00Z"));
  await runCronUntilAnalysed();
  const activity = await client.activities.get({ id });

  assert.equal(loadOf(activity.statistics, "cycling"), null);
  const prompt = thresholdPrompt({ ...activity, sport: "cycling" }, defaultsOnly);
  assert.deepEqual(prompt.search, { metric: "power" });
  assert.deepEqual(
    thresholdPrompt({ ...activity, sport: "cycling" }, { listed: true, own: ["power"] }).search,
    { sport: "cycling", metric: "power" },
    "a sport with its own power zones takes its FTP there",
  );
  assert.match(prompt.text, /^This ride has no load, because your/);
  assert.match(prompt.text, /from 5 May 2026 or earlier/);
  assert.ok(activityPowerCurve(activity.statistics).length > 0, "the power curve needs no FTP");
});

test("week totals count a workout recorded twice once, and wait for the week to load", async () => {
  const client = await athlete();
  await client.settings.write({ writes: [threshold("2026-01-01", "ftp", 250)] });
  await client.activities.upload(ride("2026-06-02T17:00:00Z"));
  await client.activities.upload(ride("2026-06-02T17:00:00Z", { seed: 2, source: "strava" }));
  await client.activities.upload(ride("2026-06-04T17:00:00Z", { seed: 3 }));
  await client.activities.upload(ride("2026-05-28T17:00:00Z", { seed: 4 }));
  await runCronUntilAnalysed();

  const { activities } = await client.activities.list({ onePerWorkout: true, limit: 50 });
  assert.equal(activities.length, 3);
  const weeks = activityWeeks(activities, false);
  assert.deepEqual(
    weeks.map(({ id, items }) => [id, items.length]),
    [
      ["2026-06-01", 2],
      ["2026-05-25", 1],
    ],
  );
  const june = weeks[0].totals;
  assert.equal(june.seconds, 3000);
  assert.equal(
    june.load,
    activities
      .filter(({ localDay }) => localDay >= "2026-06-01")
      .reduce((sum, { statistics }) => sum + statistics.load_tss, 0),
  );
  assert.equal(june.scored, 2);
  assert.deepEqual(
    activityWeeks(activities, true).map(({ complete }) => complete),
    [true, false],
    "the oldest week loaded may go on in the next page",
  );
});

test("an activity says it is updating while its analysis is due, and week totals wait for it", async () => {
  const client = await athlete();
  await client.settings.write({ writes: [threshold("2026-01-01", "ftp", 250)] });
  const { id } = await client.activities.upload(ride("2026-07-07T17:00:00Z"));

  const fresh = await client.activities.get({ id });
  assert.equal(fresh.analysisDue, true);
  assert.equal(analysisUpdating(fresh), false, "a first analysis is analysing, not updating");
  await runCronUntilAnalysed();
  const settled = await client.activities.list({ onePerWorkout: true, limit: 50 });
  assert.equal(anyAnalysisDue(settled.activities), false);
  assert.equal(activityWeeks(settled.activities, false)[0].totals.pending, 0);

  await client.settings.write({ writes: [threshold("2026-01-01", "ftp", 280)] });
  const changed = await client.activities.list({ onePerWorkout: true, limit: 50 });
  assert.equal(anyAnalysisDue(changed.activities), true);
  assert.equal(analysisUpdating(changed.activities[0]), true);
  assert.equal(
    activityWeeks(changed.activities, false)[0].totals.pending,
    1,
    "its load says so far",
  );

  await runCronUntilAnalysed();
  const final = await client.activities.get({ id });
  assert.equal(final.analysisDue, false);
  assert.equal(analysisUpdating(final), false);
  assert.ok(final.statistics.load_tss < settled.activities[0].statistics.load_tss);
});

test("weeks start on Monday and are named by their days", () => {
  assert.equal(mondayOf("2026-11-15"), "2026-11-09");
  assert.equal(mondayOf("2026-11-09"), "2026-11-09");
  assert.equal(weekLabel("2026-11-09", "2026-11-12"), "This week");
  assert.equal(weekLabel("2026-11-02", "2026-11-12"), "2-8 Nov");
  assert.equal(weekLabel("2026-10-26", "2026-11-12"), "26 Oct - 1 Nov");
  assert.equal(weekLabel("2025-12-29", "2026-11-12"), "29 Dec 2025 - 4 Jan 2026");
  assert.equal(weekLabel("2025-11-03", "2026-11-12"), "3-9 Nov 2025");
});

test("every statistic the contract names has a label of its own", () => {
  for (const { name } of [...activityStatistics, ...analysisStatistics]) {
    const { label } = figureOf(name, 1);
    assert.doesNotMatch(label, /_| (w|mps|tss|kj|bpm|rpm|kcal|ratio)$/i, `${name}: ${label}`);
  }
  assert.equal(figureOf("best_power_300s_w", 301.4).label, "Best 5 min power");
  assert.equal(figureOf("best_time_half_marathon_s", 5400).label, "Fastest half marathon");
  assert.deepEqual(figureOf("average_speed_mps", 3.2, "pace_km"), {
    name: "average_speed_mps",
    label: "Avg pace",
    value: "5:13",
    unit: "/km",
  });
  assert.deepEqual(figureOf("power_intensity_ratio", 0.8312), {
    name: "power_intensity_ratio",
    label: "Intensity",
    value: "0.83",
    unit: "",
  });
});
