import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { isDefinedError, safe } from "@orpc/client";
import { api, migrate, origin, rpcClient, send, startWorker } from "./helpers/worker.mjs";
import { mockApple } from "./helpers/apple.mjs";

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

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function rider() {
  const signedIn = await apple.signIn(runtime, { email: `${crypto.randomUUID()}@example.com` });
  return { ...signedIn, client: rpcClient(runtime, { token: signedIn.token }) };
}

const fitFile = (bytes = rideBytes, name = "ride.fit") => new File([bytes], name);

const gpx = (time) =>
  new File(
    [
      `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="test"><trk><trkseg><trkpt lat="47.5" lon="19.04"><time>${time}</time></trkpt></trkseg></trk></gpx>`,
    ],
    "run.gpx",
  );

const tcx = new File(
  [
    `﻿<?xml version="1.0"?>\n<!-- exported -->\n<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities/></TrainingCenterDatabase>`,
  ],
  "swim.tcx",
);

test("a rider uploads a ride's FIT file and reads it back by its SHA-256", async () => {
  const { client, user } = await rider();
  const uploaded = await client.activities.upload({
    file: fitFile(),
    source: "trainstack",
    sport: "indoor_cycling",
    name: "Sweet spot",
  });
  const id = sha256(rideBytes);
  assert.deepEqual(
    { ...uploaded, createdAt: undefined, summarizedAt: undefined, statistics: undefined },
    {
      id,
      source: "trainstack",
      sourceId: null,
      sport: "cycling",
      indoor: true,
      name: "Sweet spot",
      startedAt: new Date("2026-10-06T14:21:15.000Z"),
      file: { format: "fit", size: rideBytes.byteLength },
      summarizedAt: undefined,
      summaryError: null,
      statistics: undefined,
      createdAt: undefined,
      primary: true,
      duplicates: [],
    },
  );
  assert.ok(uploaded.createdAt instanceof Date);
  assert.ok(uploaded.summarizedAt instanceof Date);
  assert.equal(uploaded.statistics.elapsed_s, 1800);

  assert.deepEqual(await client.activities.list({}), { activities: [uploaded], nextCursor: null });
  const { events, ...detail } = await client.activities.get({ id });
  assert.deepEqual(detail, uploaded);
  assert.equal(events.length, 10);

  const file = await client.activities.file({ id });
  assert.equal(file.name, `${id}.fit`);
  assert.equal(file.type, "application/vnd.ant.fit");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), rideBytes);

  const stored = await bucket.get(`activities/${user.id}/${id}`);
  assert.deepEqual(Buffer.from(await stored.arrayBuffer()), rideBytes);
});

test("uploading the same file again returns the activity it already made", async () => {
  const { client } = await rider();
  const first = await client.activities.upload({ file: fitFile(), source: "trainstack" });
  const again = await client.activities.upload({
    file: fitFile(rideBytes, "renamed.fit"),
    source: "upload",
    name: "Something else",
  });
  assert.deepEqual(again, first);
  const [concurrentA, concurrentB] = await Promise.all([
    client.activities.upload({ file: gpx("2026-01-01T00:00:00Z"), source: "upload" }),
    client.activities.upload({ file: gpx("2026-01-01T00:00:00Z"), source: "upload" }),
  ]);
  assert.deepEqual(concurrentA, concurrentB);
  assert.equal((await client.activities.list({})).activities.length, 2);
});

test("a deleted activity stays deleted when a stale device uploads it again", async () => {
  const { client, user } = await rider();
  const { id } = await client.activities.upload({ file: fitFile(), source: "trainstack" });

  const deleted = await client.activities.delete({ id });
  assert.equal(deleted.id, id);
  assert.ok(deleted.deletedAt instanceof Date);
  assert.deepEqual(await client.activities.list({}), { activities: [], nextCursor: null });
  await assert.rejects(client.activities.get({ id }), { code: "NOT_FOUND", status: 404 });
  await assert.rejects(client.activities.file({ id }), { code: "NOT_FOUND", status: 404 });
  assert.equal(await bucket.head(`activities/${user.id}/${id}`), null);

  const [error, data] = await safe(
    client.activities.upload({ file: fitFile(), source: "trainstack" }),
  );
  assert.equal(data, undefined);
  assert.ok(isDefinedError(error), "the refusal is a declared error, not a failure");
  assert.equal(error.code, "ACTIVITY_DELETED");
  assert.equal(error.status, 410);
  assert.deepEqual(error.data, deleted);
  assert.equal(await bucket.head(`activities/${user.id}/${id}`), null);
  assert.deepEqual(await client.activities.list({}), { activities: [], nextCursor: null });
});

test("deleting is idempotent and keeps the first deletion time", async () => {
  const { client } = await rider();
  const { id } = await client.activities.upload({ file: fitFile(), source: "trainstack" });
  const first = await client.activities.delete({ id });
  assert.deepEqual(await client.activities.delete({ id }), first);
});

test("a device can delete an activity the server never had, so no other device can send it", async () => {
  const { client } = await rider();
  const id = sha256(rideBytes);
  const deleted = await client.activities.delete({ id });
  await assert.rejects(client.activities.upload({ file: fitFile(), source: "trainstack" }), {
    code: "ACTIVITY_DELETED",
    status: 410,
    data: deleted,
  });
});

test("each account has its own activities and its own deletions", async () => {
  const ada = await rider();
  const bob = await rider();
  const { id } = await ada.client.activities.upload({ file: fitFile(), source: "trainstack" });

  assert.deepEqual(await bob.client.activities.list({}), { activities: [], nextCursor: null });
  await assert.rejects(bob.client.activities.get({ id }), { code: "NOT_FOUND" });
  await assert.rejects(bob.client.activities.file({ id }), { code: "NOT_FOUND" });

  await bob.client.activities.delete({ id });
  assert.equal((await ada.client.activities.get({ id })).id, id);
  await assert.rejects(bob.client.activities.upload({ file: fitFile(), source: "upload" }), {
    code: "ACTIVITY_DELETED",
  });
  const file = await ada.client.activities.file({ id });
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), rideBytes);
});

test("GPX and TCX files are accepted, and anything else is refused", async () => {
  const { client } = await rider();
  const run = await client.activities.upload({
    file: gpx("2026-02-01T00:00:00Z"),
    source: "upload",
    sport: "running",
  });
  assert.deepEqual(run.file, { format: "gpx", size: gpx("2026-02-01T00:00:00Z").size });
  const swim = await client.activities.upload({ file: tcx, source: "coros", sourceId: "42" });
  assert.equal(swim.file.format, "tcx");
  assert.equal(swim.sourceId, "42");
  assert.equal(
    (await client.activities.file({ id: swim.id })).type,
    "application/vnd.garmin.tcx+xml",
  );

  for (const file of [
    new File(["not an activity"], "notes.txt"),
    new File(['<?xml version="1.0"?><html></html>'], "page.xml"),
    new File([rideBytes.subarray(0, 8)], "truncated.fit"),
  ]) {
    await assert.rejects(client.activities.upload({ file, source: "upload" }), {
      code: "UNSUPPORTED_FILE",
      status: 415,
    });
  }
  await assert.rejects(
    client.activities.upload({ file: new File([], "empty.fit"), source: "upload" }),
    {
      code: "BAD_REQUEST",
    },
  );
  await assert.rejects(client.activities.upload({ file: fitFile(), source: "Apple Health" }), {
    code: "BAD_REQUEST",
  });
  assert.equal((await client.activities.list({})).activities.length, 2);
});

test("the list pages through activities, newest first", async () => {
  const { client } = await rider();
  const days = ["2026-03-01", "2026-03-03", "2026-03-02"];
  const uploaded = [];
  for (const day of days) {
    uploaded.push(
      await client.activities.upload({
        file: gpx(`${day}T06:00:00Z`),
        source: "upload",
        startedAt: new Date(`${day}T06:00:00Z`),
      }),
    );
  }
  const summarizedRide = await client.activities.upload({
    file: fitFile(),
    source: "trainstack",
  });

  const seen = [];
  let cursor;
  do {
    const page = await client.activities.list({ limit: 2, cursor });
    assert.ok(page.activities.length <= 2);
    seen.push(...page.activities.map((activity) => activity.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.deepEqual(seen, [summarizedRide.id, uploaded[1].id, uploaded[2].id, uploaded[0].id]);
  await assert.rejects(client.activities.list({ cursor: "nonsense" }), { code: "BAD_REQUEST" });
});

test("statistics and events from any sport come back with the activity", async () => {
  const { client, user } = await rider();
  const { id } = await client.activities.upload({
    file: gpx("2026-04-01T00:00:00Z"),
    source: "strava",
    sport: "bouldering",
  });
  await db.batch([
    db
      .prepare(
        "INSERT INTO activity_statistic (user_id, activity_id, name, value) VALUES (?, ?, 'problems_sent', 7), (?, ?, 'hardest_grade_v', 5.5)",
      )
      .bind(user.id, id, user.id, id),
    db
      .prepare(
        "INSERT INTO activity_event (user_id, activity_id, sequence, type, started_at, ended_at, data) VALUES (?, ?, 1, 'attempt', 1775001600000, 1775001660000, ?), (?, ?, 0, 'lap', 1775001500000, NULL, '{}')",
      )
      .bind(user.id, id, JSON.stringify({ grade: "V5", sent: true, falls: 2 }), user.id, id),
  ]);

  const detail = await client.activities.get({ id });
  assert.deepEqual(detail.statistics, {
    elapsed_s: 0,
    timer_s: 0,
    distance_m: 0,
    problems_sent: 7,
    hardest_grade_v: 5.5,
  });
  assert.deepEqual(detail.events, [
    { type: "lap", startedAt: new Date(1775001500000), endedAt: null, data: {} },
    {
      type: "attempt",
      startedAt: new Date(1775001600000),
      endedAt: new Date(1775001660000),
      data: { grade: "V5", sent: true, falls: 2 },
    },
  ]);
  const [listed] = (await client.activities.list({})).activities;
  assert.deepEqual(listed.statistics, detail.statistics);

  await client.activities.delete({ id });
  const left = await db
    .prepare(
      "SELECT (SELECT count(*) FROM activity_statistic WHERE user_id = ?1) + (SELECT count(*) FROM activity_event WHERE user_id = ?1) AS n",
    )
    .bind(user.id)
    .first();
  assert.equal(left.n, 0);
});

test("activities need a signed-in rider, and a cookie only counts from the web app", async () => {
  const { cookie, client } = await rider();
  await client.activities.upload({ file: fitFile(), source: "trainstack" });

  const anonymous = rpcClient(runtime);
  await assert.rejects(anonymous.activities.list({}), { code: "UNAUTHORIZED", status: 401 });
  await assert.rejects(anonymous.activities.delete({ id: sha256(rideBytes) }), {
    code: "UNAUTHORIZED",
  });

  assert.equal((await rpcClient(runtime, { cookie }).activities.list({})).activities.length, 1);
  const crossSite = rpcClient(runtime, { cookie, origin: "https://attacker.example" });
  await assert.rejects(crossSite.activities.list({}), { code: "UNAUTHORIZED" });
  const withBogusBearer = rpcClient(runtime, {
    cookie,
    token: "invalid.signature",
    origin: "https://attacker.example",
  });
  await assert.rejects(withBogusBearer.activities.list({}), { code: "UNAUTHORIZED" });
  await assert.rejects(
    crossSite.activities.upload({ file: gpx("2026-05-01T00:00:00Z"), source: "upload" }),
    { code: "UNAUTHORIZED" },
  );

  const form = new FormData();
  form.set("file", gpx("2026-05-02T00:00:00Z"));
  form.set("source", "upload");
  const formPost = await send(
    runtime,
    new Request(`${api}/api-reference/activities`, {
      method: "POST",
      headers: { Cookie: cookie, "Sec-Fetch-Site": "cross-site" },
      body: form,
    }),
  );
  assert.equal(formPost.status, 401);
  assert.equal((await client.activities.list({})).activities.length, 1);
});

test("the app can use plain HTTP: multipart upload, JSON list, file download and DELETE", async () => {
  const { token, client } = await rider();
  const auth = { Authorization: `Bearer ${token}` };

  const form = new FormData();
  form.set("file", fitFile());
  form.set("source", "trainstack");
  form.set("sport", "indoor_cycling");
  form.set("name", "Sweet spot");
  const upload = await send(
    runtime,
    new Request(`${api}/api-reference/activities`, { method: "POST", headers: auth, body: form }),
  );
  assert.equal(upload.status, 200, await upload.clone().text());
  const activity = await upload.json();
  assert.equal(activity.id, sha256(rideBytes));
  assert.equal(activity.name, "Sweet spot");
  assert.equal(activity.startedAt, "2026-10-06T14:21:15.000Z");
  assert.equal(activity.statistics.average_power_w, 137);

  const list = await runtime.dispatchFetch(`${api}/api-reference/activities?limit=1`, {
    headers: auth,
  });
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).activities, [activity]);

  const file = await runtime.dispatchFetch(`${api}/api-reference/activities/${activity.id}/file`, {
    headers: auth,
  });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "application/vnd.ant.fit");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), rideBytes);

  const xml = await client.activities.upload({
    file: gpx("2026-06-02T00:00:00Z"),
    source: "upload",
  });
  const download = await runtime.dispatchFetch(`${api}/api-reference/activities/${xml.id}/file`, {
    headers: auth,
  });
  assert.match(download.headers.get("content-disposition"), /^attachment; filename=/);
  assert.equal(download.headers.get("x-content-type-options"), "nosniff");
  assert.match(download.headers.get("content-security-policy"), /sandbox/);

  const deleted = await runtime.dispatchFetch(`${api}/api-reference/activities/${activity.id}`, {
    method: "DELETE",
    headers: auth,
  });
  assert.equal(deleted.status, 200);

  const refused = await send(
    runtime,
    new Request(`${api}/api-reference/activities`, { method: "POST", headers: auth, body: form }),
  );
  assert.equal(refused.status, 410);
  const body = await refused.json();
  assert.equal(body.code, "ACTIVITY_DELETED");
  assert.equal(body.data.id, activity.id);

  const preflight = await runtime.dispatchFetch(`${api}/api-reference/activities/${activity.id}`, {
    method: "OPTIONS",
    headers: { Origin: origin, "Access-Control-Request-Method": "DELETE" },
  });
  assert.match(preflight.headers.get("access-control-allow-methods"), /DELETE/);
});

test("a full page of two hundred activities lists in one request", async () => {
  const { client, user } = await rider();
  const insert = db.prepare(
    "INSERT INTO activity (user_id, id, source, started_at) VALUES (?, ?, 'strava', ?)",
  );
  await db.batch(
    Array.from({ length: 201 }, (_, i) =>
      insert.bind(user.id, sha256(`activity ${i}`), Date.UTC(2025, 0, 1) + i * 86_400_000),
    ),
  );
  const page = await client.activities.list({ limit: 200 });
  assert.equal(page.activities.length, 200);
  assert.ok(page.nextCursor);
  const rest = await client.activities.list({ limit: 200, cursor: page.nextCursor });
  assert.deepEqual(rest.activities.length, 1);
  assert.equal(rest.nextCursor, null);
});

test("an upload a delete overtakes after it is stored answers that the activity was deleted", async () => {
  const { client, user } = await rider();
  await db
    .prepare(
      `CREATE TRIGGER delete_right_after_upload AFTER INSERT ON activity WHEN NEW.user_id = '${user.id}'
       BEGIN
         INSERT INTO deleted_activity (user_id, id) VALUES (NEW.user_id, NEW.id);
         DELETE FROM activity WHERE user_id = NEW.user_id AND id = NEW.id;
       END`,
    )
    .run();
  try {
    await assert.rejects(client.activities.upload({ file: fitFile(), source: "trainstack" }), {
      code: "ACTIVITY_DELETED",
      status: 410,
    });
  } finally {
    await db.prepare("DROP TRIGGER delete_right_after_upload").run();
  }
  assert.equal(await bucket.head(`activities/${user.id}/${sha256(rideBytes)}`), null);
  assert.deepEqual(await client.activities.list({}), { activities: [], nextCursor: null });
});

test("deleting an account deletes its activity files, and leaves other accounts' files", async () => {
  const ada = await rider();
  const bob = await rider();
  const { id } = await ada.client.activities.upload({ file: fitFile(), source: "trainstack" });
  await ada.client.activities.upload({ file: gpx("2026-07-01T00:00:00Z"), source: "upload" });
  await bob.client.activities.upload({ file: fitFile(), source: "trainstack" });
  const moreThanOneListing = Array.from(
    { length: 1001 },
    (_, i) => `activities/${ada.user.id}/${sha256(`extra ${i}`)}`,
  );
  for (let i = 0; i < moreThanOneListing.length; i += 50) {
    await Promise.all(moreThanOneListing.slice(i, i + 50).map((key) => bucket.put(key, "x")));
  }

  const deleted = await runtime.dispatchFetch(`${api}/api/auth/delete-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ada.token}` },
    body: JSON.stringify({}),
  });
  assert.equal(deleted.status, 200, await deleted.clone().text());

  const left = await bucket.list({ prefix: `activities/${ada.user.id}/` });
  assert.deepEqual(left.objects, []);
  const rows = await db
    .prepare("SELECT count(*) AS n FROM activity WHERE user_id = ?")
    .bind(ada.user.id)
    .first();
  assert.equal(rows.n, 0);
  assert.ok(await bucket.head(`activities/${bob.user.id}/${id}`));
});

test("an upload whose account is deleted before its row is stored leaves no file behind", async () => {
  const { client, user } = await rider();
  await db
    .prepare(
      `CREATE TRIGGER account_deleted_mid_upload BEFORE INSERT ON activity WHEN NEW.user_id = '${user.id}'
       BEGIN
         DELETE FROM "user" WHERE id = NEW.user_id;
       END`,
    )
    .run();
  try {
    await assert.rejects(client.activities.upload({ file: fitFile(), source: "trainstack" }));
  } finally {
    await db.prepare("DROP TRIGGER account_deleted_mid_upload").run();
  }
  const left = await bucket.list({ prefix: `activities/${user.id}/` });
  assert.deepEqual(left.objects, []);
});

test("an upload a delete overtakes while it is being summarised answers that the activity was deleted", async () => {
  const { client, user } = await rider();
  await db
    .prepare(
      `CREATE TRIGGER delete_during_summary AFTER UPDATE OF summary_attempts ON activity
       WHEN NEW.user_id = '${user.id}' AND NEW.summary_attempts = 1
       BEGIN
         INSERT INTO deleted_activity (user_id, id) VALUES (NEW.user_id, NEW.id);
         DELETE FROM activity WHERE user_id = NEW.user_id AND id = NEW.id;
       END`,
    )
    .run();
  try {
    await assert.rejects(client.activities.upload({ file: fitFile(), source: "trainstack" }), {
      code: "ACTIVITY_DELETED",
      status: 410,
    });
  } finally {
    await db.prepare("DROP TRIGGER delete_during_summary").run();
  }
  assert.equal(await bucket.head(`activities/${user.id}/${sha256(rideBytes)}`), null);
  assert.deepEqual(await client.activities.list({}), { activities: [], nextCursor: null });
});
