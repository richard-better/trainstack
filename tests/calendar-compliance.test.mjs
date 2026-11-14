import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { mockApple } from "./helpers/apple.mjs";
import { denseRide } from "./helpers/fit-files.mjs";
import { migrate, rpcClient, startWorker } from "./helpers/worker.mjs";

let worker;
let runtime;
let db;
const apple = mockApple();

before(
  async () => {
    worker = await startWorker({ outboundService: apple.fetch });
    runtime = worker.runtime;
    db = await runtime.getD1Database("DB");
    await migrate(runtime);
  },
  { timeout: 60_000 },
);

after(async () => {
  await worker?.dispose();
});

async function athlete() {
  const signedIn = await apple.signIn(runtime, { email: `${randomUUID()}@example.com` });
  const client = rpcClient(runtime, { token: signedIn.token });
  await client.settings.write({
    writes: [
      {
        day: "2026-01-01",
        change: { kind: "threshold", sport: null, threshold: "ftp", value: 200 },
        updatedAt: at(0),
      },
    ],
  });
  return { ...signedIn, client };
}

const at = (minute) => new Date(Date.UTC(2026, 10, 13, 9, minute));

async function runCronUntilAnalysed() {
  for (let run = 0; run < 30; run++) {
    const { n } = await db
      .prepare(
        `SELECT (SELECT count(*) FROM activity_analysis WHERE due = 1)
              + (SELECT count(*) FROM activity WHERE file_format IS NOT NULL AND summary_version IS NULL) AS n`,
      )
      .first();
    if (n === 0) return;
    const { outcome } = await (await runtime.getWorker()).scheduled({ cron: "* * * * *" });
    assert.equal(outcome, "ok");
  }
  assert.fail("activities were still due after thirty runs");
}

const minutes = 40;
const upload = (client, day) =>
  client.activities.upload({
    file: new File([denseRide(minutes * 60 * 25 + 200, `${day}T06:00:00Z`)], "ride.fit"),
    source: "upload",
    sport: "cycling",
  });

const powerWorkout = (low, high) => ({
  kind: "workout",
  workout: {
    name: `${low}-${high} W`,
    sport: "cycling",
    steps: [
      {
        type: "step",
        duration: { type: "time", seconds: minutes * 60 },
        target: { type: "power", unit: "watts", level: { kind: "range", low, high } },
      },
    ],
  },
  source: null,
  notes: null,
});

const plan = (client, day, content, minute = 1) =>
  client.plannedWorkouts.put({
    id: randomUUID(),
    day,
    position: 1,
    content,
    updatedAt: at(minute),
  });

test("a ride that holds the planned power for the planned time is on target, with each part saying why", async () => {
  const { client } = await athlete();
  const day = "2026-07-01";
  const { id } = await plan(client, day, powerWorkout(150, 250));
  const done = await upload(client, day);
  await runCronUntilAnalysed();
  const planned = await client.plannedWorkouts.get({ id });
  assert.deepEqual(planned.pairing, { activityId: done.id, by: "auto" });
  const { compliance } = planned;
  assert.equal(compliance.pending, false);
  assert.ok(compliance.parts.duration.score === 1, JSON.stringify(compliance.parts.duration));
  assert.ok(compliance.parts.load.ratio > 0.8, JSON.stringify(compliance.parts.load));
  assert.equal(compliance.parts.distance, null);
  const { intervals } = compliance.parts;
  assert.ok(intervals.share > 0.95, JSON.stringify(intervals));
  assert.equal(intervals.alignedBy, "time");
  assert.equal(intervals.steps.length, 1);
  assert.equal(intervals.steps[0].metric, "power");
  assert.ok(compliance.score >= 90);
  assert.equal(compliance.rating, "on_target");

  const { days } = await client.calendar.range({ from: day, through: day });
  const listed = days[0].planned[0].compliance;
  assert.equal(listed.parts.intervals.steps, null);
  assert.equal(listed.score, compliance.score);
});

test("riding well under the planned power scores low on intervals and load, and says so", async () => {
  const { client } = await athlete();
  const day = "2026-07-02";
  const { id } = await plan(client, day, powerWorkout(300, 320));
  await upload(client, day);
  await runCronUntilAnalysed();
  const { compliance } = await client.plannedWorkouts.get({ id });
  assert.equal(compliance.parts.duration.score, 1);
  assert.equal(compliance.parts.intervals.share, 0);
  assert.ok(compliance.parts.load.ratio < 0.5, JSON.stringify(compliance.parts.load));
  assert.equal(compliance.parts.load.score, 0);
  assert.equal(compliance.rating, "off_target");
  assert.ok(compliance.parts.intervals.steps[0].average < 300);
});

test("changing the plan after the ride scores the ride again against the new plan", async () => {
  const { client } = await athlete();
  const day = "2026-07-03";
  const { id } = await plan(client, day, powerWorkout(300, 320));
  await upload(client, day);
  await runCronUntilAnalysed();
  assert.equal((await client.plannedWorkouts.get({ id })).compliance.parts.intervals.share, 0);

  await client.plannedWorkouts.put({
    id,
    day,
    position: 1,
    content: powerWorkout(150, 250),
    updatedAt: at(2),
  });
  const waiting = (await client.plannedWorkouts.get({ id })).compliance;
  assert.equal(waiting.parts.intervals, null, "a score for the old plan is not shown for the new");
  assert.equal(waiting.pending, true);
  await runCronUntilAnalysed();
  const rescored = (await client.plannedWorkouts.get({ id })).compliance;
  assert.ok(rescored.parts.intervals.share > 0.95);
  assert.equal(rescored.pending, false);
});

test("a workout without targets is scored on time and load alone, and the unpaired are missed or unplanned", async () => {
  const { client } = await athlete();
  const day = "2026-07-04";
  const free = await plan(client, day, {
    kind: "workout",
    workout: {
      name: "Easy spin",
      sport: "cycling",
      steps: [
        { type: "step", duration: { type: "time", seconds: 80 * 60 }, intensity: "recovery" },
      ],
    },
    source: null,
    notes: null,
  });
  const missed = await plan(client, "2026-07-05", powerWorkout(150, 250));
  const done = await upload(client, day);
  const unplanned = await upload(client, "2026-07-06");
  await runCronUntilAnalysed();
  const { compliance } = await client.plannedWorkouts.get({ id: free.id });
  assert.equal(compliance.parts.intervals, null);
  assert.ok(Math.abs(compliance.parts.duration.ratio - 0.5) < 0.02);
  assert.ok(compliance.parts.duration.score < 0.05);
  assert.notEqual(compliance.parts.load, null);
  assert.equal(compliance.rating, "off_target");

  const later = await client.plannedWorkouts.get({ id: missed.id });
  assert.equal(later.state, "missed");
  assert.equal(later.compliance, null);
  const { days } = await client.calendar.range({ from: day, through: "2026-07-06" });
  assert.equal(days[0].activities[0].plannedId, free.id);
  assert.equal(days[0].activities[0].id, done.id);
  assert.equal(days[2].activities[0].id, unplanned.id);
  assert.equal(days[2].activities[0].plannedId, null);
});

test("an analysed ride whose day gains only a workout without targets is not read again", async () => {
  const { client, user } = await athlete();
  const day = "2026-07-08";
  await upload(client, day);
  await runCronUntilAnalysed();
  const { analyzed_at: before } = await db
    .prepare("SELECT analyzed_at FROM activity_analysis WHERE user_id = ?")
    .bind(user.id)
    .first();
  await plan(client, day, {
    kind: "workout",
    workout: {
      name: "Free ride",
      sport: "cycling",
      steps: [{ type: "step", duration: { type: "time", seconds: 2400 } }],
    },
    source: null,
    notes: null,
  });
  await runCronUntilAnalysed();
  const { analyzed_at: after } = await db
    .prepare("SELECT analyzed_at FROM activity_analysis WHERE user_id = ?")
    .bind(user.id)
    .first();
  assert.equal(after, before);
});

test("activities analysed before compliance existed are scored once the migration marks their days", async () => {
  const { client, user } = await athlete();
  const day = "2026-07-10";
  const { id } = await plan(client, day, powerWorkout(150, 250));
  await upload(client, day);
  await runCronUntilAnalysed();
  await db.batch([
    db.prepare("DELETE FROM planned_interval_compliance WHERE user_id = ?").bind(user.id),
    db
      .prepare("UPDATE activity_analysis SET planned_signature = NULL, due = 0 WHERE user_id = ?")
      .bind(user.id),
  ]);
  assert.equal((await client.plannedWorkouts.get({ id })).compliance.parts.intervals, null);
  const migrations = "hosted/apps/api/src/db/migrations";
  const folder = readdirSync(migrations).find((name) =>
    name.endsWith("_planned_interval_compliance"),
  );
  const backfill = readFileSync(`${migrations}/${folder}/migration.sql`, "utf8")
    .split("--> statement-breakpoint")
    .at(-1);
  await db.prepare(backfill).run();
  await runCronUntilAnalysed();
  assert.ok((await client.plannedWorkouts.get({ id })).compliance.parts.intervals.share > 0.95);
});

test("the calendar's activities carry their route and whether their analysis is due, and the range counts those due", async () => {
  const { client } = await athlete();
  const day = "2026-07-12";
  const outdoor = await upload(client, day);
  const indoor = await client.activities.upload({
    file: new File([denseRide(minutes * 60 * 25 + 400, `${day}T09:00:00Z`)], "trainer.fit"),
    source: "upload",
    sport: "cycling",
    indoor: true,
  });
  const before = await client.calendar.range({ from: day, through: day });
  assert.equal(before.analysesDue, 2);
  assert.deepEqual(
    before.days[0].activities.map(({ analysisDue, route }) => [analysisDue, route]),
    [
      [true, null],
      [true, null],
    ],
  );
  await runCronUntilAnalysed();
  const after = await client.calendar.range({ from: day, through: day });
  assert.equal(after.analysesDue, 0);
  const byId = Object.fromEntries(after.days[0].activities.map((done) => [done.id, done]));
  assert.equal(byId[outdoor.id].analysisDue, false);
  assert.ok(byId[outdoor.id].route.segments.length > 0);
  assert.deepEqual(byId[outdoor.id].route, (await client.activities.get({ id: outdoor.id })).route);
  assert.equal(byId[indoor.id].route, null);
});

test("power targets on a ride without power keep the intervals part, with no share and steps that say so", async () => {
  const { client } = await athlete();
  const day = "2026-07-14";
  const { id } = await plan(client, day, powerWorkout(150, 250));
  const points = Array.from({ length: minutes * 60 + 1 }, (_, second) => {
    const time = new Date(Date.parse(`${day}T06:00:00Z`) + second * 1000).toISOString();
    return `<trkpt lat="${(47.5 + second * 0.00005).toFixed(6)}" lon="19.04"><time>${time}</time></trkpt>`;
  }).join("");
  await client.activities.upload({
    file: new File(
      [
        `<?xml version="1.0"?><gpx version="1.1"><trk><type>cycling</type><trkseg>${points}</trkseg></trk></gpx>`,
      ],
      "ride.gpx",
    ),
    source: "upload",
  });
  await runCronUntilAnalysed();
  const { compliance } = await client.plannedWorkouts.get({ id });
  assert.equal(compliance.parts.intervals.share, null);
  assert.equal(compliance.parts.intervals.score, null);
  assert.deepEqual(
    compliance.parts.intervals.steps.map(({ placed, secondsWithData }) => [
      placed,
      secondsWithData,
    ]),
    [[true, 0]],
  );
  assert.equal(compliance.parts.duration.score, 1);
  assert.equal(compliance.score, 100);
});
