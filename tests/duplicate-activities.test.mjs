import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isDefinedError, safe } from "@orpc/client";
import { api, migrate, rpcClient, send, startWorker } from "./helpers/worker.mjs";
import { mockApple } from "./helpers/apple.mjs";
import { recordedSession } from "./helpers/fit-files.mjs";

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

async function rider() {
  const signedIn = await apple.signIn(runtime, { email: `${crypto.randomUUID()}@example.com` });
  return { ...signedIn, client: rpcClient(runtime, { token: signedIn.token }) };
}

async function runCron() {
  const { outcome } = await (await runtime.getWorker()).scheduled({ cron: "* * * * *" });
  assert.equal(outcome, "ok");
}

const fit = (session, name = "activity.fit") => new File([recordedSession(session)], name);

const NORTH_METRES_PER_DEGREE = 111_195;

function localTime(utcMs, offsetMinutes) {
  const local = new Date(utcMs + offsetMinutes * 60_000).toISOString().slice(0, 19);
  if (offsetMinutes === 0) return `${local}Z`;
  const sign = offsetMinutes > 0 ? "+" : "-";
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
  return `${local}${sign}${hours}:${minutes}`;
}

function gpx({ start, minutes, type = "ride", metresPerMinute = 500, offsetMinutes = 0 }) {
  const startMs = Date.parse(start);
  const points = Array.from({ length: minutes + 1 }, (_, minute) => {
    const lat = 47.4 + (minute * metresPerMinute) / NORTH_METRES_PER_DEGREE;
    return `<trkpt lat="${lat.toFixed(6)}" lon="19.04"><time>${localTime(startMs + minute * 60_000, offsetMinutes)}</time></trkpt>`;
  }).join("");
  return new File(
    [
      `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="watch"><trk><type>${type}</type><trkseg>${points}</trkseg></trk></gpx>`,
    ],
    "watch.gpx",
  );
}

const workoutsOf = async (client) =>
  (await client.activities.list({ onePerWorkout: true })).activities;

const sortedIds = (ids) => [...ids].sort();

function assertOneWorkout(entries, primaryId, otherIds) {
  assert.equal(entries.length, 1, "the athlete sees one workout");
  const [entry] = entries;
  assert.equal(entry.id, primaryId);
  assert.equal(entry.primary, true);
  assert.deepEqual(sortedIds(entry.duplicates.map(({ id }) => id)), sortedIds(otherIds));
  assert.ok(entry.duplicates.every(({ primary }) => primary === false));
}

const indoorRide = {
  start: "2026-10-01T17:00:00Z",
  elapsedSeconds: 3600,
  sport: "cycling",
  subSport: "indoorCycling",
  distanceMetres: 31_000,
  power: 210,
  heartRate: 142,
  cadence: 88,
};

const watchOfIndoorRide = {
  start: "2026-10-01T16:59:00Z",
  elapsedSeconds: 3690,
  sport: "cycling",
  heartRate: 141,
};

test("Ride's file and the watch's file of one indoor ride become one workout, Ride's standing for it", async () => {
  const { client } = await rider();
  const watch = await client.activities.upload({ file: fit(watchOfIndoorRide), source: "upload" });
  const ride = await client.activities.upload({
    file: fit(indoorRide),
    source: "trainstack",
    sport: "indoor_cycling",
  });

  assert.equal(ride.primary, true);
  assert.deepEqual(
    ride.duplicates.map(({ id, source, primary }) => ({ id, source, primary })),
    [{ id: watch.id, source: "upload", primary: false }],
  );
  assertOneWorkout(await workoutsOf(client), ride.id, [watch.id]);

  const watchDetail = await client.activities.get({ id: watch.id });
  assert.equal(watchDetail.primary, false);
  assert.deepEqual(
    watchDetail.duplicates.map(({ id, primary }) => ({ id, primary })),
    [{ id: ride.id, primary: true }],
  );

  const everything = await client.activities.list({});
  assert.deepEqual(
    sortedIds(everything.activities.map(({ id }) => id)),
    sortedIds([ride.id, watch.id]),
  );

  for (const { id } of [ride, watch]) {
    const file = await client.activities.file({ id });
    assert.ok(file.size > 0, "every source's file stays downloadable");
  }
});

test("the same two files arriving at the same moment still make one workout", async () => {
  const { client } = await rider();
  const [ride, watch] = await Promise.all([
    client.activities.upload({
      file: fit(indoorRide),
      source: "trainstack",
      sport: "indoor_cycling",
    }),
    client.activities.upload({ file: fit(watchOfIndoorRide), source: "upload" }),
  ]);
  assertOneWorkout(await workoutsOf(client), ride.id, [watch.id]);
});

test("a head unit that auto-paused matches the watch's GPX of the same ride, written in local time", async () => {
  const { client } = await rider();
  const watch = await client.activities.upload({
    file: gpx({ start: "2026-09-12T06:30:00Z", minutes: 150, offsetMinutes: 120 }),
    source: "upload",
  });
  assert.deepEqual(watch.startedAt, new Date("2026-09-12T06:30:00Z"));
  const headUnit = await client.activities.upload({
    file: fit({
      start: "2026-09-12T06:31:00Z",
      elapsedSeconds: 148 * 60,
      timerSeconds: 121 * 60,
      sport: "cycling",
      subSport: "road",
      distanceMetres: watch.statistics.distance_m * 1.03,
      power: 190,
      heartRate: 138,
      cadence: 84,
    }),
    source: "upload",
  });
  assertOneWorkout(await workoutsOf(client), headUnit.id, [watch.id]);
});

test("two rides back to back stay two workouts, even when the first was stopped late", async () => {
  const { client } = await rider();
  await client.activities.upload({
    file: fit({ start: "2026-08-01T09:00:00Z", elapsedSeconds: 62 * 60, distanceMetres: 30_000 }),
    source: "upload",
  });
  await client.activities.upload({
    file: fit({
      start: "2026-08-01T10:00:00Z",
      elapsedSeconds: 60 * 60,
      distanceMetres: 29_000,
      power: 200,
    }),
    source: "trainstack",
  });
  const entries = await workoutsOf(client);
  assert.equal(entries.length, 2);
  assert.ok(entries.every(({ primary, duplicates }) => primary && duplicates.length === 0));
});

test("a brick session links the bike recordings and keeps the run on its own", async () => {
  const { client } = await rider();
  const ride = await client.activities.upload({
    file: fit({ ...indoorRide, start: "2026-07-05T07:00:00Z" }),
    source: "trainstack",
    sport: "indoor_cycling",
  });
  const watchBike = await client.activities.upload({
    file: fit({ start: "2026-07-05T06:59:00Z", elapsedSeconds: 3720, heartRate: 150 }),
    source: "upload",
  });
  const watchRun = await client.activities.upload({
    file: fit({
      start: "2026-07-05T08:02:00Z",
      elapsedSeconds: 1800,
      sport: "running",
      distanceMetres: 6000,
      heartRate: 160,
    }),
    source: "upload",
  });
  const entries = await workoutsOf(client);
  assert.deepEqual(
    entries.map(({ id, duplicates }) => ({ id, duplicates: duplicates.map(({ id }) => id) })),
    [
      { id: watchRun.id, duplicates: [] },
      { id: ride.id, duplicates: [watchBike.id] },
    ],
  );
});

test("a long ride with a cafe stop is one workout, though the watch saved it in two halves", async () => {
  const { client } = await rider();
  const beforeCoffee = await client.activities.upload({
    file: fit({
      start: "2026-06-20T08:00:00Z",
      elapsedSeconds: 7200,
      distanceMetres: 52_000,
      heartRate: 135,
    }),
    source: "upload",
  });
  const afterCoffee = await client.activities.upload({
    file: fit({
      start: "2026-06-20T10:45:00Z",
      elapsedSeconds: 4500,
      distanceMetres: 45_000,
      heartRate: 137,
    }),
    source: "upload",
  });
  const headUnit = await client.activities.upload({
    file: fit({
      start: "2026-06-20T07:59:00Z",
      elapsedSeconds: 4 * 3600 + 120,
      timerSeconds: 3 * 3600 + 15 * 60,
      distanceMetres: 98_500,
      power: 175,
      heartRate: 136,
      cadence: 82,
    }),
    source: "upload",
  });
  assertOneWorkout(await workoutsOf(client), headUnit.id, [beforeCoffee.id, afterCoffee.id]);
});

test("a file whose clock is wrong is not matched, and the athlete can link it by hand", async () => {
  const { client } = await rider();
  const ride = await client.activities.upload({
    file: fit({ ...indoorRide, start: "2026-05-02T18:00:00Z" }),
    source: "trainstack",
    sport: "indoor_cycling",
  });
  const wrongClock = await client.activities.upload({
    file: fit({ ...watchOfIndoorRide, start: "2025-01-01T00:00:00Z" }),
    source: "upload",
  });
  assert.equal((await workoutsOf(client)).length, 2);

  const linked = await client.activities.link({ id: wrongClock.id, to: ride.id });
  assert.equal(linked.primary, false);
  assertOneWorkout(await workoutsOf(client), ride.id, [wrongClock.id]);
});

test("the athlete's primary sticks when another copy arrives and when activities are summarised again", async () => {
  const { client, user } = await rider();
  const ride = await client.activities.upload({
    file: fit({ ...indoorRide, start: "2026-04-03T17:00:00Z" }),
    source: "trainstack",
    sport: "indoor_cycling",
  });
  const watch = await client.activities.upload({
    file: fit({ ...watchOfIndoorRide, start: "2026-04-03T16:59:00Z" }),
    source: "upload",
  });
  assertOneWorkout(await workoutsOf(client), ride.id, [watch.id]);

  const chosen = await client.activities.makePrimary({ id: watch.id });
  assert.equal(chosen.primary, true);
  assertOneWorkout(await workoutsOf(client), watch.id, [ride.id]);

  const later = await client.activities.upload({
    file: fit({ ...indoorRide, start: "2026-04-03T17:00:05Z", power: 215 }),
    source: "strava",
  });
  assertOneWorkout(await workoutsOf(client), watch.id, [ride.id, later.id]);

  await db.prepare("UPDATE activity SET summary_version = 1 WHERE user_id = ?").bind(user.id).run();
  for (let run = 0; run < 10; run++) await runCron();
  const { results } = await db
    .prepare("SELECT summary_version, match_version FROM activity WHERE user_id = ?")
    .bind(user.id)
    .all();
  assert.deepEqual(
    results.map((row) => [row.summary_version, row.match_version]),
    [
      [4, 1],
      [4, 1],
      [4, 1],
    ],
    "every copy was summarised and matched again",
  );
  assertOneWorkout(await workoutsOf(client), watch.id, [ride.id, later.id]);
});

test("an activity the athlete says is not the same stays apart, through rematching and new arrivals", async () => {
  const { client, user } = await rider();
  const ride = await client.activities.upload({
    file: fit({ ...indoorRide, start: "2026-03-03T17:00:00Z" }),
    source: "trainstack",
    sport: "indoor_cycling",
  });
  const watch = await client.activities.upload({
    file: fit({ ...watchOfIndoorRide, start: "2026-03-03T16:59:00Z" }),
    source: "upload",
  });

  const apart = await client.activities.unlink({ id: watch.id });
  assert.deepEqual(
    { primary: apart.primary, duplicates: apart.duplicates },
    { primary: true, duplicates: [] },
  );
  assert.equal((await workoutsOf(client)).length, 2);

  await db
    .prepare("UPDATE activity SET match_version = NULL WHERE user_id = ?")
    .bind(user.id)
    .run();
  await runCron();
  assert.equal((await workoutsOf(client)).length, 2);

  const third = await client.activities.upload({
    file: fit({ ...indoorRide, start: "2026-03-03T17:00:10Z", power: 205 }),
    source: "strava",
  });
  const entries = await workoutsOf(client);
  assert.equal(entries.length, 2, "the new copy joins one of them, not both");
  const groups = entries.map(({ id, duplicates }) =>
    sortedIds([id, ...duplicates.map(({ id }) => id)]),
  );
  assert.ok(
    groups.some((group) => group.length === 2 && group.includes(third.id)),
    "the new copy is linked to one of the two",
  );
  assert.ok(!groups.some((group) => group.includes(ride.id) && group.includes(watch.id)));

  await client.activities.link({ id: watch.id, to: ride.id });
  assert.equal((await workoutsOf(client)).length, 1);
});

test("deleting one copy keeps the other, which stands for the workout, and the deleted copy stays deleted", async () => {
  const { client } = await rider();
  const watch = await client.activities.upload({
    file: fit({ ...watchOfIndoorRide, start: "2026-02-01T16:59:00Z" }),
    source: "upload",
  });
  const ride = await client.activities.upload({
    file: fit({ ...indoorRide, start: "2026-02-01T17:00:00Z" }),
    source: "trainstack",
    sport: "indoor_cycling",
  });
  assertOneWorkout(await workoutsOf(client), ride.id, [watch.id]);

  await client.activities.delete({ id: ride.id });
  assertOneWorkout(await workoutsOf(client), watch.id, []);
  assert.ok((await client.activities.file({ id: watch.id })).size > 0);

  const [error] = await safe(
    client.activities.upload({
      file: fit({ ...indoorRide, start: "2026-02-01T17:00:00Z" }),
      source: "trainstack",
      sport: "indoor_cycling",
    }),
  );
  assert.ok(isDefinedError(error));
  assert.equal(error.code, "ACTIVITY_DELETED");
  assertOneWorkout(await workoutsOf(client), watch.id, []);
});

test("activities stored before matching existed are matched by the scheduled pass", async () => {
  const { client, user } = await rider();
  const ride = await client.activities.upload({
    file: fit({ ...indoorRide, start: "2026-01-10T17:00:00Z" }),
    source: "trainstack",
    sport: "indoor_cycling",
  });
  const watch = await client.activities.upload({
    file: fit({ ...watchOfIndoorRide, start: "2026-01-10T16:59:00Z" }),
    source: "upload",
  });
  await db
    .prepare(
      "UPDATE activity SET workout_id = id, is_primary = 1, match_version = NULL WHERE user_id = ?",
    )
    .bind(user.id)
    .run();
  assert.equal((await workoutsOf(client)).length, 2);

  await runCron();
  assertOneWorkout(await workoutsOf(client), ride.id, [watch.id]);
});

test("two outdoor rides that overlap in time but covered different distances stay apart", async () => {
  const { client } = await rider();
  await client.activities.upload({
    file: fit({ start: "2026-05-09T10:00:00Z", elapsedSeconds: 7200, distanceMetres: 55_000 }),
    source: "upload",
  });
  await client.activities.upload({
    file: fit({ start: "2026-05-09T10:20:00Z", elapsedSeconds: 7200, distanceMetres: 21_000 }),
    source: "upload",
  });
  assert.equal((await workoutsOf(client)).length, 2);
});

test("a plain list still holds every copy, so Ride's sync never takes a linked ride for a deleted one", async () => {
  const { client, token } = await rider();
  const ride = await client.activities.upload({
    file: fit({ ...indoorRide, start: "2026-01-20T17:00:00Z" }),
    source: "trainstack",
    sport: "indoor_cycling",
  });
  const watch = await client.activities.upload({
    file: fit({ ...watchOfIndoorRide, start: "2026-01-20T16:59:00Z" }),
    source: "upload",
  });
  await client.activities.makePrimary({ id: watch.id });
  assertOneWorkout(await workoutsOf(client), watch.id, [ride.id]);

  const response = await send(
    runtime,
    new Request(`${api}/api-reference/activities?limit=200`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
  assert.equal(response.status, 200);
  const { activities } = await response.json();
  assert.deepEqual(sortedIds(activities.map(({ id }) => id)), sortedIds([ride.id, watch.id]));
});
