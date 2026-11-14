import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { mockApple } from "./helpers/apple.mjs";
import { jsonLines, readTar } from "./helpers/tar.mjs";
import { signInOnTheWeb } from "./helpers/web.mjs";
import { api, migrate, origin, r2Buckets, startWorker } from "./helpers/worker.mjs";

const RIDES = [
  "apps/ride/RideKit/Sources/RideData/Resources/SampleRide.fit",
  "apps/ride/RideKit/Tests/RideCoreTests/Traces/trainer-and-strap.fit",
];
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const NOT_TABLES_OF_THE_APP = /^(sqlite_|_cf_|d1_|__drizzle)/;

const apple = mockApple();
const strava = { deauthorized: [], nextAthleteId: 0 };
let worker;
let runtime;
let db;
let bucket;

async function stravaServer(request) {
  const url = new URL(request.url);
  if (url.pathname === "/oauth/token") {
    return Response.json({
      token_type: "Bearer",
      access_token: `strava-access-${randomUUID()}`,
      refresh_token: `strava-refresh-${randomUUID()}`,
      expires_at: 4_102_444_800,
      athlete: { id: strava.nextAthleteId, firstname: "Ada", lastname: "Rider" },
    });
  }
  if (url.pathname === "/oauth/deauthorize") {
    strava.deauthorized.push(request.headers.get("authorization"));
    return Response.json({});
  }
  return new Response("unexpected", { status: 500 });
}

before(
  async () => {
    worker = await startWorker({
      bindings: {
        STRAVA_CLIENT_ID: "12345",
        STRAVA_CLIENT_SECRET: "client-secret-value",
        APPLE_SIGN_IN_KEY_ID: "TESTKEY123",
        APPLE_SIGN_IN_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "P-256" })
          .privateKey.export({ type: "pkcs8", format: "pem" })
          .toString(),
      },
      outboundService: (request) =>
        new URL(request.url).origin === "https://appleid.apple.com"
          ? apple.fetch(request)
          : stravaServer(request),
    });
    runtime = worker.runtime;
    await migrate(runtime);
    db = await runtime.getD1Database("DB");
    bucket = await runtime.getR2Bucket("ACTIVITY_FILES");
  },
  { timeout: 60_000 },
);

after(async () => {
  await worker?.dispose();
});

const at = (minute) => new Date(Date.UTC(2026, 10, 13, 9, minute));

async function webRequest(athlete, path, init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin") && init.method && init.method !== "GET") headers.set("Origin", origin);
  if (!headers.has("Sec-Fetch-Site")) headers.set("Sec-Fetch-Site", "same-site");
  return athlete.browser.visit(`${api}${path}`, { ...init, headers });
}

async function connectStrava(token) {
  const call = (path, init = {}) =>
    runtime.dispatchFetch(`${api}/strava${path}`, {
      redirect: "manual",
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
    });
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const started = await call("/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code_challenge: challenge }),
  });
  assert.equal(started.status, 200, await started.clone().text());
  const state = new URL((await started.json()).url).searchParams.get("state");
  const back = await runtime.dispatchFetch(
    `${api}/strava/callback?state=${encodeURIComponent(state)}&code=c&scope=read,activity:write`,
    { redirect: "manual" },
  );
  assert.equal(back.status, 302);
  const completed = await call("/connect/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code_verifier: verifier }),
  });
  assert.equal(completed.status, 200, await completed.clone().text());
}

async function athleteWithEverything(identity) {
  const athlete = await signInOnTheWeb(runtime, apple, `${origin}/`, identity);
  const { webApp } = athlete;
  const user = await db
    .prepare('SELECT id FROM "user" WHERE email = ?')
    .bind(athlete.email)
    .first();
  athlete.userId = user.id;
  athlete.rides = [];
  for (const path of RIDES) {
    const bytes = await readFile(path);
    const uploaded = await webApp.activities.upload({
      file: new File([bytes], path.split("/").at(-1)),
      source: "trainstack",
    });
    athlete.rides.push({ id: uploaded.id, bytes });
  }
  const unwanted = await webApp.activities.upload({
    file: new File(
      [
        `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg><trkpt lat="47.5" lon="19.04"><time>2026-07-01T00:00:00Z</time></trkpt></trkseg></trk></gpx>`,
      ],
      "run.gpx",
    ),
    source: "upload",
  });
  await webApp.activities.delete({ id: unwanted.id });
  await db
    .prepare("INSERT INTO distinct_activities (user_id, activity_id, other_id) VALUES (?, ?, ?)")
    .bind(athlete.userId, athlete.rides[0].id, athlete.rides[1].id)
    .run();
  await db
    .prepare("INSERT INTO activity_sync (user_id, source, cursor) VALUES (?, 'apple_health', 'c1')")
    .bind(athlete.userId)
    .run();
  await db
    .prepare("INSERT INTO feedback (id, user_id, created_at, issue_number) VALUES (?, ?, ?, 7)")
    .bind(randomUUID(), athlete.userId, Math.floor(Date.now() / 1000))
    .run();
  await webApp.settings.write({
    writes: [
      {
        day: "2026-03-01",
        change: { kind: "threshold", sport: null, threshold: "ftp", value: 250 },
        updatedAt: at(0),
      },
      { day: "2026-03-01", change: { kind: "weight", kg: 72.5 }, updatedAt: at(0) },
    ],
  });
  await webApp.settings.setTimeZone({ timeZone: "Europe/Budapest" });
  const workoutId = randomUUID();
  await webApp.workouts.put({
    id: workoutId,
    workout: {
      name: "Sweet spot",
      sport: "cycling",
      steps: [
        {
          type: "step",
          duration: { type: "time", seconds: 600 },
          target: { type: "power", unit: "ftp", level: { kind: "constant", value: 0.9 } },
        },
      ],
    },
    updatedAt: at(1),
  });
  const listId = randomUUID();
  await webApp.workoutLists.put({ id: listId, name: "Base block", updatedAt: at(2) });
  await webApp.workoutLists.place({ id: listId, workoutId, after: null, updatedAt: at(3) });
  const session = await db
    .prepare("SELECT token FROM session WHERE user_id = ? LIMIT 1")
    .bind(athlete.userId)
    .first();
  athlete.token = session.token;
  athlete.stravaAthleteId = 900_000_000 + Math.floor(Math.random() * 99_999_999);
  strava.nextAthleteId = athlete.stravaAthleteId;
  await connectStrava(athlete.token);
  return athlete;
}

async function exportOf(athlete, options) {
  const response = await webRequest(athlete, "/account/export");
  assert.equal(response.status, 200, response.ok ? "" : await response.text());
  return { response, entries: await readTar(response.body, options) };
}

const appTables = async () =>
  (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results
    .map(({ name }) => name)
    .filter((name) => !NOT_TABLES_OF_THE_APP.test(name))
    .sort();

const readmeOf = (entries) =>
  entries.find(({ path }) => path.endsWith("/README.md")).bytes.toString();

const exportedTablesIn = (readme) =>
  [...readme.matchAll(/^### data\/(\w+)\/$/gm)].map(([, name]) => name).sort();

const notExportedTablesIn = (readme) =>
  [...readme.matchAll(/^- `(\w+)`: \S/gm)].map(([, name]) => name).sort();

async function rowsOf(table, userId) {
  const columns = (await db.prepare(`PRAGMA table_info("${table}")`).all()).results.map(
    ({ name }) => name,
  );
  const owner = table === "user" ? "id" : "user_id";
  assert.ok(columns.includes(owner), `${table} has no ${owner} column to find an athlete's rows`);
  return (await db.prepare(`SELECT * FROM "${table}" WHERE ${owner} = ?`).bind(userId).all())
    .results;
}

let everything;
const athleteWithEverythingOnce = async () => (everything ??= await athleteWithEverything());

test("every table in the database is either in the export or says why it is not", async () => {
  const { entries } = await exportOf(await athleteWithEverythingOnce(), {
    keep: (path) => path.endsWith("README.md"),
  });
  const readme = readmeOf(entries);
  const exported = exportedTablesIn(readme);
  const explained = notExportedTablesIn(readme);
  assert.deepEqual([...exported, ...explained].sort(), await appTables());
  assert.deepEqual(
    exported.filter((name) => explained.includes(name)),
    [],
    "no table is both exported and left out",
  );
});

test("the seeded athlete has rows in every table the export covers, so the export of each is checked", async () => {
  const athlete = await athleteWithEverythingOnce();
  const { entries } = await exportOf(athlete, { keep: (path) => path.endsWith("README.md") });
  for (const table of exportedTablesIn(readmeOf(entries))) {
    assert.ok(
      (await rowsOf(table, athlete.userId)).length > 0,
      `seed ${table} in athleteWithEverything`,
    );
  }
});

test("an athlete's export holds every row of theirs, every original file, and no credentials", async () => {
  const athlete = await athleteWithEverythingOnce();
  const other = await athleteWithEverything();
  const { response, entries } = await exportOf(athlete);
  assert.equal(response.headers.get("content-type"), "application/x-tar");
  assert.match(
    response.headers.get("content-disposition"),
    /^attachment; filename="trainstack-export-\d{4}-\d{2}-\d{2}\.tar"$/,
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  const folder = entries[0].path.split("/")[0];
  assert.ok(entries.every(({ path }) => path.startsWith(`${folder}/`)));
  assert.ok(entries.every(({ type, magic }) => type === "0" && magic === "ustar"));

  const readme = readmeOf(entries);
  for (const table of exportedTablesIn(readme)) {
    const stored = await rowsOf(table, athlete.userId);
    const archived = jsonLines(entries, `${folder}/data/${table}`);
    assert.equal(archived.length, stored.length, `${table} rows`);
  }

  const [activity] = jsonLines(entries, `${folder}/data/activity`).filter(
    ({ id }) => id === athlete.rides[0].id,
  );
  assert.equal(activity.source, "trainstack");
  assert.equal(activity.fileSport, "cycling");
  assert.equal(activity.startedAt, "2026-10-06T14:21:15.000Z");
  const statistics = jsonLines(entries, `${folder}/data/activity_statistic`).filter(
    ({ activityId }) => activityId === athlete.rides[0].id,
  );
  assert.ok(statistics.some(({ name }) => name === "elapsed_s"));
  assert.ok(jsonLines(entries, `${folder}/data/activity_event`).length > 0);
  assert.deepEqual(
    jsonLines(entries, `${folder}/data/athlete_setting`)
      .map(({ day, value }) => ({ day, value }))
      .sort((a, b) => a.value.kind.localeCompare(b.value.kind)),
    [
      {
        day: "2026-03-01",
        value: { kind: "threshold", sport: null, threshold: "ftp", value: 250 },
      },
      { day: "2026-03-01", value: { kind: "weight", kg: 72.5 } },
    ],
  );
  assert.deepEqual(
    jsonLines(entries, `${folder}/data/athlete_time_zone`).map(({ timeZone }) => timeZone),
    ["Europe/Budapest"],
  );
  assert.ok(
    jsonLines(entries, `${folder}/data/activity_analysis`).some(
      ({ activityId }) => activityId === athlete.rides[0].id,
    ),
  );
  const [workout] = jsonLines(entries, `${folder}/data/workout`);
  assert.equal(workout.body.name, "Sweet spot");
  const [connection] = jsonLines(entries, `${folder}/data/strava_connection`);
  assert.deepEqual(Object.keys(connection).sort(), [
    "athleteId",
    "athleteName",
    "createdAt",
    "expiresAt",
    "updatedAt",
    "userId",
  ]);
  const [identity] = jsonLines(entries, `${folder}/data/account`);
  assert.equal(identity.providerId, "apple");
  assert.equal(identity.accountId, athlete.subject);
  for (const credential of ["accessToken", "refreshToken", "idToken", "password"]) {
    assert.ok(!(credential in identity), `${credential} is left out`);
  }
  assert.ok(jsonLines(entries, `${folder}/data/session`).every((row) => !("token" in row)));

  const files = entries.filter(({ path }) => path.startsWith(`${folder}/activities/`));
  assert.deepEqual(
    files
      .map(({ path, sha256 }) => ({ path, sha256 }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    athlete.rides
      .map(({ id, bytes }) => ({
        path: `${folder}/activities/${id}.fit`,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  );

  const archive = Buffer.concat(entries.map(({ bytes }) => bytes));
  const secrets = [
    athlete.token,
    `apple-refresh-${athlete.subject}`,
    other.userId,
    other.email,
    ...(await db
      .prepare("SELECT access_token, refresh_token FROM strava_connection WHERE user_id = ?")
      .bind(athlete.userId)
      .first()
      .then(Object.values)),
  ];
  for (const secret of secrets) {
    assert.equal(archive.indexOf(secret), -1, `the archive holds ${secret}`);
  }
});

test("only the signed-in athlete gets their export", async () => {
  const athlete = await athleteWithEverythingOnce();
  const anonymous = await runtime.dispatchFetch(`${api}/account/export`);
  assert.equal(anonymous.status, 401);
  const crossSite = await webRequest(athlete, "/account/export", {
    headers: { "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(crossSite.status, 401, "another site cannot start a download with the cookie");
  const otherOrigin = await webRequest(athlete, "/account/export", {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(otherOrigin.status, 401);
  const bearer = await runtime.dispatchFetch(`${api}/account/export`, {
    headers: { Authorization: `Bearer ${athlete.token}` },
  });
  assert.equal(bearer.status, 200);
  await bearer.body.cancel();
});

test("an account at the upload limits streams out whole: many files, each up to 25 MB", async () => {
  const athlete = await signInOnTheWeb(runtime, apple);
  const { id: userId } = await db
    .prepare('SELECT id FROM "user" WHERE email = ?')
    .bind(athlete.email)
    .first();
  const largest = [];
  for (let i = 0; i < 3; i += 1) {
    const bytes = randomBytes(MAX_FILE_BYTES);
    const id = createHash("sha256").update(bytes).digest("hex");
    await bucket.put(`activities/${userId}/${id}`, bytes, {
      httpMetadata: { contentType: "application/vnd.ant.fit" },
    });
    largest.push({ id, sha256: id });
  }
  const moreThanOneListing = Array.from({ length: 1001 }, (_, i) =>
    createHash("sha256").update(`small ${userId} ${i}`).digest("hex"),
  );
  for (let i = 0; i < moreThanOneListing.length; i += 50) {
    await Promise.all(
      moreThanOneListing.slice(i, i + 50).map((id) =>
        bucket.put(`activities/${userId}/${id}`, `ride ${id}`, {
          httpMetadata: { contentType: "application/gpx+xml" },
        }),
      ),
    );
  }

  const { entries } = await exportOf(athlete, { keep: (path) => !path.endsWith(".fit") });
  const files = entries.filter(({ path }) => path.includes("/activities/"));
  assert.equal(files.length, largest.length + moreThanOneListing.length);
  for (const { id, sha256 } of largest) {
    const file = files.find(({ path }) => path.endsWith(`/activities/${id}.fit`));
    assert.equal(file?.size, MAX_FILE_BYTES);
    assert.equal(file.sha256, sha256);
  }
  assert.match(readmeOf(entries), /1004 files, 78\d{6} bytes\./);
});

test("deleting an account leaves nothing of the athlete, revokes Strava and Apple, and a new sign-in starts empty", async () => {
  const athlete = await athleteWithEverything({
    subject: `001234.${randomUUID()}`,
    email: `${randomUUID()}@example.com`,
  });
  const other = await athleteWithEverything();
  const strangers = await appTables();
  const otherRowsBefore = await Promise.all(
    strangers.map(async (table) => [table, await countMentions(table, other.userId)]),
  );
  const { access_token: stravaCipher } = await db
    .prepare("SELECT access_token FROM strava_connection WHERE user_id = ?")
    .bind(athlete.userId)
    .first();
  assert.ok(stravaCipher);
  strava.deauthorized.length = 0;
  apple.revocations.length = 0;

  const deleted = await webRequest(athlete, "/api/auth/delete-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(deleted.status, 200, await deleted.clone().text());

  const traces = [athlete.userId, athlete.email, athlete.subject, String(athlete.stravaAthleteId)];
  for (const table of await appTables()) {
    const rows = (await db.prepare(`SELECT * FROM "${table}"`).all()).results;
    for (const trace of traces) {
      const left = rows.filter((row) => JSON.stringify(row).includes(trace));
      assert.deepEqual(left, [], `${table} still holds ${trace}`);
    }
  }
  for (const name of r2Buckets) {
    const files = await runtime.getR2Bucket(name);
    let cursor;
    do {
      const page = await files.list({ cursor });
      assert.deepEqual(
        page.objects.filter(({ key }) => key.includes(athlete.userId)).map(({ key }) => key),
        [],
        `${name} still holds files of the athlete`,
      );
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  assert.deepEqual(
    await Promise.all(
      strangers.map(async (table) => [table, await countMentions(table, other.userId)]),
    ),
    otherRowsBefore,
    "the other athlete keeps everything",
  );

  assert.equal(strava.deauthorized.length, 1, "Strava is told the athlete left");
  assert.match(strava.deauthorized[0], /^Bearer strava-access-/);
  assert.deepEqual(
    apple.revocations.map((form) => form.get("token")),
    [`apple-refresh-${athlete.subject}`],
  );

  const stale = await webRequest(athlete, "/account/export");
  assert.equal(stale.status, 401, "the deleted account's session is gone");

  const again = await signInOnTheWeb(runtime, apple, `${origin}/`, {
    subject: athlete.subject,
    email: athlete.email,
  });
  const fresh = await db
    .prepare('SELECT id FROM "user" WHERE email = ?')
    .bind(athlete.email)
    .first();
  assert.notEqual(fresh.id, athlete.userId);
  assert.deepEqual((await again.webApp.activities.list({})).activities, []);
  assert.deepEqual((await again.webApp.settings.history({})).entries, []);
  assert.deepEqual((await again.webApp.workouts.list({})).workouts, []);
});

async function countMentions(table, trace) {
  const rows = (await db.prepare(`SELECT * FROM "${table}"`).all()).results;
  return rows.filter((row) => JSON.stringify(row).includes(trace)).length;
}

test("an account is deleted only from a session made in the last day, and signing in again allows it", async () => {
  const athlete = await signInOnTheWeb(runtime, apple);
  const { id: userId } = await db
    .prepare('SELECT id FROM "user" WHERE email = ?')
    .bind(athlete.email)
    .first();
  await db
    .prepare("UPDATE session SET created_at = ? WHERE user_id = ?")
    .bind(Date.now() - 2 * 24 * 60 * 60 * 1000, userId)
    .run();
  const refused = await webRequest(athlete, "/api/auth/delete-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).code, "SESSION_EXPIRED");
  assert.ok(await db.prepare('SELECT id FROM "user" WHERE id = ?').bind(userId).first());

  const again = await signInOnTheWeb(runtime, apple, `${origin}/`, {
    subject: athlete.subject,
    email: athlete.email,
  });
  const deleted = await webRequest(again, "/api/auth/delete-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(deleted.status, 200, await deleted.clone().text());
  assert.equal(await db.prepare('SELECT id FROM "user" WHERE id = ?').bind(userId).first(), null);
});

test("Strava budgets past their window are forgotten by the scheduled run", async () => {
  const now = Math.floor(Date.now() / 1000);
  await db.batch([
    db
      .prepare("INSERT INTO strava_budget (key, window_start, used) VALUES (?, ?, 3)")
      .bind("athlete:1", now - 16 * 60),
    db
      .prepare("INSERT INTO strava_budget (key, window_start, used) VALUES (?, ?, 3)")
      .bind("athlete:2", now - 60),
  ]);
  const { outcome } = await (await runtime.getWorker()).scheduled({ cron: "* * * * *" });
  assert.equal(outcome, "ok");
  const keys = (
    await db.prepare("SELECT key FROM strava_budget WHERE key IN ('athlete:1', 'athlete:2')").all()
  ).results.map(({ key }) => key);
  assert.deepEqual(keys, ["athlete:2"]);
});
