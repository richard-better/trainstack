import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { migrate, rpcClient, startWorker } from "./helpers/worker.mjs";
import { mockApple } from "./helpers/apple.mjs";

const SAMPLE_RIDE = "apps/ride/RideKit/Sources/RideData/Resources/SampleRide.fit";

let worker;
let runtime;
let db;
let rideBytes;
const apple = mockApple();

before(
  async () => {
    worker = await startWorker({ outboundService: apple.fetch });
    runtime = worker.runtime;
    await migrate(runtime);
    db = await runtime.getD1Database("DB");
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
const gpx = (time) =>
  new File(
    [
      `<?xml version="1.0"?><gpx version="1.1"><trk><type>running</type><trkseg><trkpt lat="47.5" lon="19.04"><time>${time}</time></trkpt></trkseg></trk></gpx>`,
    ],
    "run.gpx",
  );

async function summariseEverythingAgain() {
  await db.prepare("UPDATE activity SET summary_version = 0").run();
  for (let run = 0; run < 20; run++) {
    const { n } = await db
      .prepare("SELECT count(*) AS n FROM activity WHERE summary_version = 0")
      .first();
    if (n === 0) return;
    const { outcome } = await (await runtime.getWorker()).scheduled({ cron: "* * * * *" });
    assert.equal(outcome, "ok");
  }
  assert.fail("activities were still due after twenty runs");
}

test("an activity's day comes from its file, else the athlete's zone when it arrived, and stays put", async () => {
  const { client } = await athlete();
  const lateUtc = await client.activities.upload({
    file: gpx("2026-03-02T23:30:00Z"),
    source: "upload",
  });
  assert.equal(lateUtc.localDay, "2026-03-02");
  assert.equal(lateUtc.localDaySource, "time_zone");

  await assert.rejects(client.settings.setTimeZone({ timeZone: "Mars/Olympus" }), {
    code: "INVALID_TIME_ZONE",
  });
  await assert.rejects(client.settings.setTimeZone({ timeZone: "+02:00" }), {
    code: "INVALID_TIME_ZONE",
  });
  assert.deepEqual(await client.settings.setTimeZone({ timeZone: "Europe/Budapest" }), {
    timeZone: "Europe/Budapest",
  });
  assert.equal((await client.settings.get({})).timeZone, "Europe/Budapest");

  const budapest = await client.activities.upload({
    file: gpx("2026-03-03T23:30:00Z"),
    source: "upload",
  });
  assert.equal(budapest.localDay, "2026-03-04");
  const ride = await client.activities.upload({ file: fitFile(), source: "trainstack" });
  assert.equal(ride.localDay, "2026-10-06");
  assert.equal(ride.localDaySource, "file");

  await client.settings.setTimeZone({ timeZone: "America/Los_Angeles" });
  await db.prepare("UPDATE activity SET local_day = NULL WHERE id = ?").bind(budapest.id).run();
  await summariseEverythingAgain();
  assert.equal((await client.activities.get({ id: lateUtc.id })).localDay, "2026-03-02");
  assert.equal((await client.activities.get({ id: budapest.id })).localDay, "2026-03-04");
  assert.equal((await client.activities.get({ id: ride.id })).localDay, "2026-10-06");
  const later = await client.activities.upload({
    file: gpx("2026-03-05T05:00:00Z"),
    source: "upload",
  });
  assert.equal(later.localDay, "2026-03-04");
});

test("activities stored before days existed get one when they are summarised again", async () => {
  const { client, user } = await athlete();
  const { id } = await client.activities.upload({ file: fitFile(), source: "trainstack" });
  const evening = await client.activities.upload({
    file: gpx("2026-03-06T22:30:00Z"),
    source: "upload",
  });
  await db
    .prepare(
      "UPDATE activity SET local_day = NULL, local_day_source = NULL, local_day_zone = NULL WHERE user_id = ?",
    )
    .bind(user.id)
    .run();
  await client.settings.setTimeZone({ timeZone: "Asia/Tokyo" });
  await summariseEverythingAgain();
  const ride = await client.activities.get({ id });
  assert.deepEqual([ride.localDay, ride.localDaySource], ["2026-10-06", "file"]);
  const run = await client.activities.get({ id: evening.id });
  assert.deepEqual([run.localDay, run.localDaySource], ["2026-03-07", "time_zone"]);
});
