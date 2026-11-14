import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { migrate, rpcClient, startWorker } from "./helpers/worker.mjs";
import { mockApple } from "./helpers/apple.mjs";
import { denseRide, recordsAtOneMoment } from "./helpers/fit-files.mjs";

const SAMPLE_RIDE = "apps/ride/RideKit/Sources/RideData/Resources/SampleRide.fit";

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

async function athlete() {
  const signedIn = await apple.signIn(runtime, { email: `${crypto.randomUUID()}@example.com` });
  return { ...signedIn, client: rpcClient(runtime, { token: signedIn.token }) };
}

const fitFile = (bytes = rideBytes) => new File([bytes], "ride.fit");
let clock = Date.parse("2026-11-01T00:00:00Z");
const put = (day, change) => ({ day, change, updatedAt: new Date((clock += 1000)) });
const threshold = (name, value, sport = null) => ({
  kind: "threshold",
  sport,
  threshold: name,
  value,
});

async function runCron() {
  const { outcome } = await (await runtime.getWorker()).scheduled({ cron: "* * * * *" });
  assert.equal(outcome, "ok");
}

async function runCronUntilAnalysed() {
  for (let run = 0; run < 30; run++) {
    const due = await db
      .prepare("SELECT count(*) AS n FROM activity_analysis WHERE due = 1 OR version < 3")
      .first();
    const unsummarised = await db
      .prepare(
        "SELECT count(*) AS n FROM activity WHERE file_format IS NOT NULL AND (summary_version IS NULL OR summary_version < 4)",
      )
      .first();
    if (due.n === 0 && unsummarised.n === 0) return;
    await runCron();
  }
  assert.fail("activities were still due after thirty runs");
}

test("an uploaded ride is analysed by the scheduled pass, and says which thresholds it lacked", async () => {
  const { client } = await athlete();
  const uploaded = await client.activities.upload({ file: fitFile(), source: "trainstack" });
  assert.equal(uploaded.analyzedAt, null);
  assert.equal(uploaded.analysisDue, true);
  assert.equal(uploaded.localDay, "2026-10-06");
  assert.equal(uploaded.localDaySource, "file");

  await runCronUntilAnalysed();
  const ride = await client.activities.get({ id: uploaded.id });
  assert.ok(ride.analyzedAt instanceof Date);
  assert.equal(ride.analysisDue, false);
  assert.equal(ride.analysisError, null);
  assert.equal(ride.statistics.normalized_power_w, 139);
  assert.equal(ride.statistics.work_kj, 246);
  assert.equal(ride.statistics.best_power_300s_w, 154);
  assert.equal(ride.statistics.average_power_w, 137);
  assert.equal(ride.statistics.power_stress_tss, undefined);
  assert.equal(ride.statistics.load_tss, undefined);
  assert.deepEqual(ride.missingThresholds, [
    "ftp",
    "lactate_threshold_heart_rate",
    "max_heart_rate",
    "resting_heart_rate",
  ]);
  assert.equal(ride.events.length, 10);
  for (const lap of ride.events) {
    assert.equal(typeof lap.data.normalized_power_w, "number");
    assert.equal(typeof lap.data.work_kj, "number");
    assert.equal(typeof lap.data.average_power_w, "number");
    assert.equal(lap.data.average_grade_adjusted_speed_mps, undefined);
  }
});

test("a threshold correction re-analyses the activities of the days it covers, and only those", async () => {
  const { client, user } = await athlete();
  await client.settings.write({
    writes: [put("2026-01-01", threshold("ftp", 200))],
  });
  const october = await client.activities.upload({ file: fitFile(), source: "trainstack" });
  const august = await client.activities.upload({
    file: fitFile(denseRide(60_000, "2026-08-02T06:00:00Z")),
    source: "upload",
  });
  await runCronUntilAnalysed();
  const before = await client.activities.get({ id: october.id });
  const augustBefore = await client.activities.get({ id: august.id });
  assert.equal(before.statistics.power_intensity_ratio, 139 / 200);
  assert.equal(before.statistics.power_stress_tss, before.statistics.load_tss);
  assert.ok(augustBefore.statistics.load_tss > 0);
  assert.ok(!before.missingThresholds.includes("ftp"));

  await client.settings.write({ writes: [put("2026-09-01", threshold("ftp", 250))] });
  const waiting = await client.activities.get({ id: october.id });
  assert.equal(waiting.analysisDue, true);
  assert.deepEqual(waiting.analyzedAt, before.analyzedAt);
  assert.equal((await client.activities.get({ id: august.id })).analysisDue, true);
  await runCronUntilAnalysed();
  const after = await client.activities.get({ id: october.id });
  const augustAfter = await client.activities.get({ id: august.id });
  assert.equal(after.statistics.power_intensity_ratio, 139 / 250);
  assert.ok(after.statistics.load_tss < before.statistics.load_tss);
  assert.ok(after.analyzedAt > before.analyzedAt);
  assert.deepEqual(augustAfter.statistics, augustBefore.statistics);
  assert.deepEqual(augustAfter.analyzedAt, augustBefore.analyzedAt);
  assert.equal(after.analysisDue, false);
  assert.equal(augustAfter.analysisDue, false);

  await client.settings.write({ writes: [put("2026-02-01", { kind: "weight", kg: 70 })] });
  await runCronUntilAnalysed();
  assert.deepEqual((await client.activities.get({ id: october.id })).analyzedAt, after.analyzedAt);
  const rows = await db
    .prepare("SELECT due, attempts FROM activity_analysis WHERE user_id = ?")
    .bind(user.id)
    .all();
  assert.deepEqual(
    rows.results.map((row) => [row.due, row.attempts]),
    [
      [0, 0],
      [0, 0],
    ],
  );
});

test("a run without its thresholds still gets its best efforts, and asks for threshold pace", async () => {
  const { client } = await athlete();
  const points = Array.from({ length: 601 }, (_, second) => {
    const time = new Date(Date.parse("2026-10-10T07:00:00Z") + second * 1000).toISOString();
    return `<trkpt lat="${(47.5 + (second * 3.5) / 111_195).toFixed(7)}" lon="19.04"><ele>100</ele><time>${time}</time></trkpt>`;
  }).join("");
  const run = await client.activities.upload({
    file: new File(
      [
        `<?xml version="1.0"?><gpx version="1.1"><trk><type>running</type><trkseg>${points}</trkseg></trk></gpx>`,
      ],
      "run.gpx",
    ),
    source: "upload",
  });
  await runCronUntilAnalysed();
  const analysed = await client.activities.get({ id: run.id });
  assert.equal(analysed.sport, "running");
  assert.ok(Math.abs(analysed.statistics.best_time_1km_s - 1000 / 3.5) < 2);
  assert.ok(analysed.statistics.average_grade_adjusted_speed_mps > 3);
  assert.equal(analysed.statistics.pace_stress_tss, undefined);
  assert.deepEqual(analysed.missingThresholds, ["threshold_pace"]);
});

test("the analysis version re-analyses every activity", async () => {
  const { client, user } = await athlete();
  const { id } = await client.activities.upload({ file: fitFile(), source: "trainstack" });
  await runCronUntilAnalysed();
  const first = await client.activities.get({ id });
  await db.batch([
    db.prepare("UPDATE activity_analysis SET version = 0 WHERE user_id = ?").bind(user.id),
    db
      .prepare(
        "INSERT INTO activity_statistic (user_id, activity_id, name, value) VALUES (?, ?, 'time_in_power_zone_9_s', 1)",
      )
      .bind(user.id, id),
  ]);
  assert.equal((await client.activities.get({ id })).analysisDue, true);
  await runCronUntilAnalysed();
  const again = await client.activities.get({ id });
  assert.equal(again.analysisDue, false);
  assert.ok(again.analyzedAt > first.analyzedAt);
  assert.deepEqual(again.statistics, first.statistics);
});

test("summarising an analysed activity again brings back its laps' analysis", async () => {
  const { client, user } = await athlete();
  const { id } = await client.activities.upload({ file: fitFile(), source: "trainstack" });
  await runCronUntilAnalysed();
  const analysed = await client.activities.get({ id });
  await db.prepare("UPDATE activity SET summary_version = 0 WHERE user_id = ?").bind(user.id).run();
  await runCronUntilAnalysed();
  const again = await client.activities.get({ id });
  assert.deepEqual(again.events, analysed.events);
  assert.deepEqual(again.statistics, analysed.statistics);
  assert.equal(typeof again.events[0].data.normalized_power_w, "number");
});

test("a file with more records than the analysis reads says so and is not retried", async () => {
  const { client, user } = await athlete();
  const { id } = await client.activities.upload({
    file: fitFile(recordsAtOneMoment(7 * 24 * 60 * 60 + 2)),
    source: "upload",
  });
  await runCronUntilAnalysed();
  const activity = await client.activities.get({ id });
  assert.equal(activity.summaryError, null);
  assert.equal(activity.analysisError, "too_large");
  assert.equal(activity.analyzedAt, null);
  const row = await db
    .prepare("SELECT due, attempts, version FROM activity_analysis WHERE user_id = ?")
    .bind(user.id)
    .first();
  assert.deepEqual(row, { due: 0, attempts: 0, version: 3 });

  await bucket.delete(`activities/${user.id}/${id}`);
  await client.settings.write({ writes: [put("2026-01-01", threshold("ftp", 210))] });
  await runCronUntilAnalysed();
  assert.equal((await client.activities.get({ id })).analysisError, "too_large");
  assert.deepEqual(
    await db
      .prepare("SELECT due, attempts, version FROM activity_analysis WHERE user_id = ?")
      .bind(user.id)
      .first(),
    { due: 0, attempts: 0, version: 3 },
  );
});

test("an analysis that keeps dying is retried a bounded number of times, while others go ahead", async () => {
  const { client, user } = await athlete();
  await runCronUntilAnalysed();
  const dying = await client.activities.upload({
    file: fitFile(denseRide(10_000, "2026-07-01T00:00:00Z")),
    source: "upload",
  });
  await bucket.delete(`activities/${user.id}/${dying.id}`);
  const healthy = await client.activities.upload({
    file: fitFile(denseRide(10_000, "2026-06-01T00:00:00Z")),
    source: "upload",
  });
  for (let run = 1; run <= 3; run++) {
    await runCron();
    const row = await db
      .prepare(
        "SELECT attempts, error FROM activity_analysis WHERE user_id = ? AND activity_id = ?",
      )
      .bind(user.id, dying.id)
      .first();
    assert.deepEqual(row, { attempts: run, error: null });
  }
  assert.ok((await client.activities.get({ id: healthy.id })).analyzedAt instanceof Date);
  await runCron();
  const failed = await client.activities.get({ id: dying.id });
  assert.equal(failed.analysisError, "failed");
  assert.equal(failed.analyzedAt, null);

  await client.settings.write({ writes: [put("2026-01-02", { kind: "weight", kg: 71 })] });
  await runCron();
  await client.settings.write({ writes: [put("2026-01-01", threshold("ftp", 220))] });
  await runCron();
  const row = await db
    .prepare(
      "SELECT due, attempts, error FROM activity_analysis WHERE user_id = ? AND activity_id = ?",
    )
    .bind(user.id, dying.id)
    .first();
  assert.deepEqual(row, { due: 0, attempts: 3, error: "failed" });
});

test("a scheduled run reads at most its budget of file bytes, and at least one file", async () => {
  const { client } = await athlete();
  await runCronUntilAnalysed();
  const big = [];
  for (let day = 1; day <= 3; day++) {
    big.push(
      await client.activities.upload({
        file: fitFile(denseRide(20 * 1024 * 1024, `2026-05-0${day}T00:00:00Z`)),
        source: "upload",
      }),
    );
  }
  const analysed = async () =>
    (await Promise.all(big.map(({ id }) => client.activities.get({ id })))).filter(
      (activity) => activity.analyzedAt !== null,
    ).length;
  await runCron();
  assert.equal(await analysed(), 2);
  await runCron();
  assert.equal(await analysed(), 3);
});

test("an activity whose file does not decode is not analysed", async () => {
  const { client } = await athlete();
  const broken = new Uint8Array(rideBytes);
  broken[broken.length - 1] ^= 0xff;
  const { id } = await client.activities.upload({ file: fitFile(broken), source: "upload" });
  await runCronUntilAnalysed();
  const activity = await client.activities.get({ id });
  assert.equal(activity.summaryError, "corrupt");
  assert.equal(activity.analyzedAt, null);
  assert.equal(activity.analysisError, null);
  assert.equal(activity.analysisDue, false);
  assert.deepEqual(activity.missingThresholds, []);
});

const gpx = (segments) =>
  new File(
    [
      `<?xml version="1.0"?><gpx version="1.1"><trk><type>cycling</type>${segments
        .map(
          (points) =>
            `<trkseg>${points
              .map(
                ({ seconds, latitude, longitude }) =>
                  `<trkpt lat="${latitude.toFixed(6)}" lon="${longitude.toFixed(6)}"><time>${new Date(Date.parse("2026-09-05T07:00:00Z") + seconds * 1000).toISOString()}</time></trkpt>`,
              )
              .join("")}</trkseg>`,
        )
        .join("")}</trk></gpx>`,
    ],
    "ride.gpx",
  );

const along = (from, seconds, start = 0) =>
  Array.from({ length: seconds }, (_, second) => ({
    seconds: start + second,
    latitude: 47.5 + second * 0.00005,
    longitude: from + second * 0.0001,
  }));

function decodedPolyline(text) {
  const points = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = text.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < text.length) {
    latitude += next();
    longitude += next();
    points.push([latitude / 1e5, longitude / 1e5]);
  }
  return points;
}

test("a ride paused halfway has a route in two pieces, with no line across the pause", async () => {
  const { client } = await athlete();
  const { id } = await client.activities.upload({
    file: gpx([along(19, 600), along(19.2, 600, 900)]),
    source: "upload",
  });
  assert.equal((await client.activities.get({ id })).route, null);
  await runCronUntilAnalysed();
  const { route } = await client.activities.get({ id });
  assert.equal(route.segments.length, 2);
  const [first, second] = route.segments.map(decodedPolyline);
  assert.deepEqual(first[0], [47.5, 19]);
  assert.deepEqual(second[0], [47.5, 19.2]);
  assert.deepEqual(route.bounds, [19, 47.5, 19.2 + 599 * 0.0001, 47.5 + 599 * 0.00005]);
  const listed = await client.activities.list({});
  assert.deepEqual(listed.activities[0].route, route);
});

test("a GPS gap splits the route, and an indoor ride or a file without positions has none", async () => {
  const { client } = await athlete();
  const gapped = await client.activities.upload({
    file: gpx([[...along(19, 300), ...along(19.1, 300, 600)]]),
    source: "upload",
  });
  const indoor = await client.activities.upload({
    file: gpx([along(19, 300)]),
    source: "upload",
    indoor: true,
    startedAt: new Date("2026-09-06T07:00:00Z"),
  });
  const rideFile = await client.activities.upload({ file: fitFile(), source: "trainstack" });
  await runCronUntilAnalysed();
  assert.equal((await client.activities.get({ id: gapped.id })).route.segments.length, 2);
  assert.equal((await client.activities.get({ id: indoor.id })).route, null);
  assert.equal((await client.activities.get({ id: rideFile.id })).route, null);
});

test("a dense file of a week of winding positions gets a route inside the cap in one scheduled run", async () => {
  const { client } = await athlete();
  const semicircles = (degrees) => Math.round((degrees * 2 ** 31) / 180);
  const { id } = await client.activities.upload({
    file: fitFile(
      denseRide(26_000_000, "2026-07-01T00:00:00Z", {
        position: (i) => [
          semicircles(47.5 + 0.05 * Math.sin(i / 3000) + i * 1e-7),
          semicircles(19 + 0.05 * Math.cos(i / 3000) + i * 1e-7),
        ],
      }),
    ),
    source: "upload",
  });
  await runCron();
  const { route, analyzedAt } = await client.activities.get({ id });
  assert.ok(analyzedAt instanceof Date);
  const points = route.segments.flatMap(decodedPolyline);
  assert.ok(points.length <= 300 && points.length > 50, `${points.length} points`);
  assert.ok(route.segments.join("").length < 3000);
});
