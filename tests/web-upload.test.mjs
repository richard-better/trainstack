import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { ACTIVITIES_PER_PAGE } from "../hosted/apps/account/src/lib/client.ts";
import {
  checkActivityFile,
  sendActivityFile,
  withActivity,
} from "../hosted/apps/account/src/lib/upload.ts";
import { createUploads } from "../hosted/apps/account/src/lib/uploads.ts";
import { mockApple } from "./helpers/apple.mjs";
import { signInOnTheWeb } from "./helpers/web.mjs";
import { migrate, startWorker } from "./helpers/worker.mjs";

const MAX_BYTES = 25 * 1024 * 1024;
const FILES = "packages/activity-file/test/files";
const SAMPLE_RIDE = "apps/ride/RideKit/Sources/RideData/Resources/SampleRide.fit";
const WORKOUT_RIDE = "apps/ride/RideKit/Tests/RideCoreTests/Traces/quick-test-trainer-drop.fit";

const apple = mockApple();
let worker;
let runtime;

before(
  async () => {
    worker = await startWorker({
      bindings: {
        NODE_ENV: "production",
        APPLE_SIGN_IN_KEY_ID: "TESTKEY123",
        APPLE_SIGN_IN_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "P-256" })
          .privateKey.export({ type: "pkcs8", format: "pem" })
          .toString(),
      },
      outboundService: (r) => apple.fetch(r),
    });
    runtime = worker.runtime;
    await migrate(runtime);
  },
  { timeout: 60_000 },
);

after(async () => {
  await worker?.dispose();
});

const fileAt = async (path, name = path.split("/").at(-1)) =>
  new File([await readFile(path)], name);

function uploadsFor(webApp) {
  const added = [];
  const uploads = createUploads({
    api: webApp,
    maxBytes: MAX_BYTES,
    onActivity: (activity) => added.push(activity),
  });
  const outcomes = () =>
    Object.fromEntries(
      uploads
        .list()
        .map(({ name, state }) => [
          name,
          state.phase === "done"
            ? state.outcome.kind
            : state.phase === "refused"
              ? state.refusal.kind
              : state.phase,
        ]),
    );
  return { uploads, added, outcomes };
}

test("a FIT, GPX or TCX file is read in the browser for its sport and start", async () => {
  const read = async (path) => {
    const check = await checkActivityFile(await fileAt(path), MAX_BYTES);
    assert.equal(check.kind, "ready", path);
    return { format: check.file.format, sport: check.file.sport, startedAt: check.file.startedAt };
  };
  assert.deepEqual(await read(WORKOUT_RIDE), {
    format: "fit",
    sport: "indoor_cycling",
    startedAt: new Date("2027-01-15T08:00:00.000Z"),
  });
  assert.deepEqual(await read(`${FILES}/strava-ride.gpx`), {
    format: "gpx",
    sport: "cycling",
    startedAt: new Date("2026-09-12T06:58:31.000Z"),
  });
  assert.deepEqual(await read(`${FILES}/strava-run.tcx`), {
    format: "tcx",
    sport: "running",
    startedAt: new Date("2026-10-10T05:45:00.000Z"),
  });
});

test("a wrong, empty, damaged or oversized file is refused before anything is sent", async () => {
  class Oversized extends File {
    get size() {
      return MAX_BYTES + 1;
    }
    arrayBuffer() {
      throw new Error("an oversized file is not read");
    }
  }
  const sample = await readFile(SAMPLE_RIDE);
  const refusal = async (file) => checkActivityFile(file, MAX_BYTES);
  assert.deepEqual(await refusal(new Oversized([sample], "huge.fit")), { kind: "tooLarge" });
  assert.deepEqual(await refusal(new File(["milk\neggs\n"], "notes.fit")), {
    kind: "notActivityFile",
  });
  assert.deepEqual(await refusal(new File([], "empty.gpx")), { kind: "notActivityFile" });
  assert.deepEqual(await refusal(new File([sample.subarray(0, 4000)], "cut.fit")), {
    kind: "damaged",
    format: "fit",
  });
  assert.deepEqual(await refusal(await fileAt(`${FILES}/route-without-times.gpx`)), {
    kind: "noActivity",
    format: "gpx",
  });
});

test("several files upload at once, each with its own outcome, and only activity files are sent", async () => {
  const { webApp, ride } = await signInOnTheWeb(runtime, apple);
  const already = await ride.activities.upload({
    file: await fileAt(SAMPLE_RIDE),
    source: "trainstack",
  });
  const { uploads, added, outcomes } = uploadsFor(webApp);

  await uploads.add([
    await fileAt(WORKOUT_RIDE),
    await fileAt(`${FILES}/strava-ride.gpx`),
    await fileAt(`${FILES}/strava-run.tcx`),
    await fileAt(SAMPLE_RIDE),
    await fileAt(WORKOUT_RIDE, "the-same-workout.fit"),
    new File(["milk\neggs\n"], "notes.txt"),
    new File([(await readFile(SAMPLE_RIDE)).subarray(0, 4000)], "cut.fit"),
  ]);

  assert.deepEqual(outcomes(), {
    "quick-test-trainer-drop.fit": "uploaded",
    "strava-ride.gpx": "uploaded",
    "strava-run.tcx": "uploaded",
    "SampleRide.fit": "alreadyThere",
    "the-same-workout.fit": "alreadyThere",
    "notes.txt": "notActivityFile",
    "cut.fit": "damaged",
  });
  const { activities } = await webApp.activities.list({ limit: ACTIVITIES_PER_PAGE });
  assert.deepEqual(
    activities.map(({ name, sport, startedAt, source }) => ({
      name,
      sport,
      startedAt: startedAt?.toISOString() ?? null,
      source,
    })),
    [
      {
        name: "Quick test 45s",
        sport: "indoor_cycling",
        startedAt: "2027-01-15T08:00:00.000Z",
        source: "upload",
      },
      { name: null, sport: "running", startedAt: "2026-10-10T05:45:00.000Z", source: "upload" },
      { name: null, sport: "cycling", startedAt: "2026-10-06T14:21:15.000Z", source: "trainstack" },
      {
        name: "Morning Ride & Coffee",
        sport: "cycling",
        startedAt: "2026-09-12T06:58:31.000Z",
        source: "upload",
      },
    ],
    "nothing refused reached the server, and the server read each file for its name, sport and date",
  );
  const workout = await readFile(WORKOUT_RIDE);
  assert.equal(
    added.find((activity) => activity.name === "Quick test 45s").id,
    createHash("sha256").update(workout).digest("hex"),
  );
  assert.ok(added.some((activity) => activity.id === already.id));
  assert.equal(uploads.list().length, 7);
  uploads.clearFinished();
  assert.deepEqual(uploads.list(), []);
});

test("a file the athlete deleted is not added again, and says when it was deleted", async () => {
  const { webApp } = await signInOnTheWeb(runtime, apple);
  const run = await fileAt(`${FILES}/strava-run.tcx`);
  const check = await checkActivityFile(run, MAX_BYTES);
  assert.equal(check.kind, "ready");
  const first = await sendActivityFile(webApp, check.file);
  assert.equal(first.kind, "uploaded");
  const { deletedAt } = await webApp.activities.delete({ id: first.activity.id });

  const { uploads, added, outcomes } = uploadsFor(webApp);
  await uploads.add([run]);
  assert.deepEqual(outcomes(), { "strava-run.tcx": "deletedBefore" });
  assert.deepEqual(uploads.list()[0].state.outcome.deletedAt, deletedAt);
  assert.deepEqual(added, []);
  assert.deepEqual((await webApp.activities.list({ limit: 10 })).activities, []);
});

test("an upload that fails on the way can be tried again without choosing the file again", async () => {
  const { webApp } = await signInOnTheWeb(runtime, apple);
  let online = false;
  const sent = [];
  const flaky = {
    activities: {
      get: (input) =>
        online ? webApp.activities.get(input) : Promise.reject(new TypeError("offline")),
      upload: (input) => {
        sent.push(input);
        return webApp.activities.upload(input);
      },
    },
  };
  const added = [];
  const uploads = createUploads({
    api: flaky,
    maxBytes: MAX_BYTES,
    onActivity: (activity) => added.push(activity),
  });

  await uploads.add([await fileAt(`${FILES}/strava-ride.gpx`)]);
  const [failed] = uploads.list();
  assert.equal(failed.state.phase, "failed");
  assert.equal(failed.sport, "cycling");

  online = true;
  await uploads.retry(failed.key);
  assert.equal(uploads.list()[0].state.outcome.kind, "uploaded");
  assert.equal(added.length, 1);
  assert.deepEqual(
    sent.map(({ file, ...fields }) => ({ name: file.name, ...fields })),
    [
      {
        name: "strava-ride.gpx",
        source: "upload",
        startedAt: new Date("2026-09-12T06:58:31.000Z"),
      },
    ],
    "the server reads the sport and name from the file, so the athlete can still set their own",
  );
});

test("signing out forgets uploads, and one still running does not come back", async () => {
  const { webApp } = await signInOnTheWeb(runtime, apple);
  const { uploads, added } = uploadsFor(webApp);
  const running = uploads.add([await fileAt(`${FILES}/garmin-connect-run.gpx`)]);
  uploads.clear();
  await running;
  assert.deepEqual(uploads.list(), []);
  assert.deepEqual(added, []);
});

const activity = (id, startedAt) => ({
  id: id.repeat(64),
  source: "upload",
  sourceId: null,
  sport: null,
  name: null,
  startedAt: startedAt === null ? null : new Date(startedAt),
  file: null,
  summarizedAt: null,
  statistics: {},
  createdAt: new Date("2026-11-01"),
});

const ids = (pages) => pages.map((page) => page.activities.map((a) => a.id[0]).join(""));

test("a new activity takes its place by date among the loaded pages", () => {
  const pages = [
    { activities: [activity("a", "2026-10-30"), activity("b", "2026-10-20")], nextCursor: "1" },
    { activities: [activity("c", "2026-10-10"), activity("d", "2026-10-01")], nextCursor: "2" },
  ];
  assert.deepEqual(ids(withActivity(pages, activity("n", "2026-11-05"))), ["nab", "cd"]);
  assert.deepEqual(ids(withActivity(pages, activity("n", "2026-10-15"))), ["ab", "ncd"]);
  assert.deepEqual(
    ids(withActivity(pages, activity("n", "2026-09-01"))),
    ["ab", "cd"],
    "an activity older than every loaded one waits for its page",
  );
  assert.deepEqual(
    ids(withActivity([{ ...pages[1], nextCursor: null }], activity("n", "2026-09-01"))),
    ["cdn"],
    "the oldest of all goes at the end once there are no more pages",
  );
  assert.deepEqual(
    ids(withActivity([{ activities: [], nextCursor: null }], activity("n", "2026-11-05"))),
    ["n"],
  );
  assert.deepEqual(
    ids(withActivity(pages, { ...activity("c", "2026-10-25") })),
    ["acb", "d"],
    "an activity already in the list moves instead of appearing twice",
  );
  assert.deepEqual(
    ids(withActivity(pages, activity("n", null))),
    ["nab", "cd"],
    "without a start time, it is placed by when it was added",
  );
});
