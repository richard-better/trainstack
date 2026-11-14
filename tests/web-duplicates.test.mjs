import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { refreshWorkoutOf, withActivity } from "../hosted/apps/account/src/lib/upload.ts";
import {
  applyChange,
  arrivalText,
  deletingSource,
  linkCandidates,
  linkSearchText,
  membersOf,
  nearWindow,
  primaryIdOf,
  sourceLabel,
  sourcesOf,
  undoOf,
} from "../hosted/apps/account/src/lib/workouts.ts";
import { mockApple } from "./helpers/apple.mjs";
import { recordedSession } from "./helpers/fit-files.mjs";
import { migrate, rpcClient, startWorker } from "./helpers/worker.mjs";

let worker;
let runtime;
const apple = mockApple();

before(
  async () => {
    worker = await startWorker({ outboundService: apple.fetch });
    runtime = worker.runtime;
    await migrate(runtime);
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

const fit = (session, name = "activity.fit") => new File([recordedSession(session)], name);

const rideRecording = {
  start: "2026-10-01T17:00:00Z",
  elapsedSeconds: 3600,
  sport: "cycling",
  subSport: "indoorCycling",
  distanceMetres: 31_000,
  power: 210,
  heartRate: 142,
  cadence: 88,
};

const watchRecording = {
  start: "2026-10-01T16:59:00Z",
  elapsedSeconds: 3690,
  sport: "cycling",
  heartRate: 141,
};

async function rideAndWatch(client) {
  const watch = await client.activities.upload({ file: fit(watchRecording), source: "upload" });
  const ride = await client.activities.upload({
    file: fit(rideRecording),
    source: "trainstack",
    sport: "indoor_cycling",
  });
  return { ride, watch };
}

const workouts = async (client) =>
  (await client.activities.list({ onePerWorkout: true })).activities;

test("the list shows Ride's and the watch's recording of one ride once, with the watch as another source", async () => {
  const client = await athlete();
  const { ride, watch } = await rideAndWatch(client);

  const [only, ...rest] = await workouts(client);
  assert.deepEqual(rest, []);
  assert.equal(only.id, ride.id);
  assert.equal(only.duplicates.length, 1, "the row says the workout has 2 sources");

  const watchPage = await client.activities.get({ id: watch.id });
  assert.equal(primaryIdOf(watchPage), ride.id, "the watch's page leads to the workout");
  assert.deepEqual(
    sourcesOf(watchPage).map((source) => [sourceLabel(source), source.primary, source.current]),
    [
      ["Ride", true, false],
      ["Uploaded FIT file", false, true],
    ],
  );
});

test("an uploaded file of a workout already in the account says so and leads to that workout", async () => {
  const client = await athlete();
  const ride = await client.activities.upload({
    file: fit(rideRecording),
    source: "trainstack",
    sport: "indoor_cycling",
  });
  const watch = await client.activities.upload({ file: fit(watchRecording), source: "upload" });

  assert.equal(watch.primary, false);
  assert.equal(arrivalText(watch, true), "Uploaded, linked to the same workout from Ride");
  assert.equal(primaryIdOf(watch), ride.id);
  assert.equal(arrivalText({ duplicates: [] }, false), "Already in your account");

  const pages = [{ activities: [{ ...ride, duplicates: [] }], nextCursor: null }];
  const [page] = withActivity(pages, watch);
  assert.deepEqual(
    page.activities.map(({ id, duplicates }) => [id, duplicates.map(({ id }) => id)]),
    [[ride.id, [watch.id]]],
    "the workout's row gains a source instead of the list gaining a row",
  );

  const queryClient = new QueryClient();
  const detailKey = (id) => ["activity", id];
  queryClient.setQueryData(detailKey(ride.id), { ...ride, duplicates: [] });
  queryClient.setQueryData([...detailKey(ride.id), "file"], new File([], "ride.fit"));
  refreshWorkoutOf(queryClient, watch, detailKey);
  assert.equal(
    queryClient.getQueryState(detailKey(ride.id)).isInvalidated,
    true,
    "the workout's page shows the new source when opened next",
  );
  assert.equal(queryClient.getQueryState([...detailKey(ride.id), "file"]).isInvalidated, false);
  queryClient.clear();
});

test("a richer file arriving later takes the workout's row in the list", async () => {
  const client = await athlete();
  const watch = await client.activities.upload({ file: fit(watchRecording), source: "upload" });
  const pages = [{ activities: [watch], nextCursor: null }];
  const ride = await client.activities.upload({
    file: fit(rideRecording),
    source: "trainstack",
    sport: "indoor_cycling",
  });
  assert.equal(ride.primary, true);
  const [page] = withActivity(pages, ride);
  assert.deepEqual(
    page.activities.map(({ id }) => id),
    [ride.id],
  );
});

test("making another source the primary is undone by making the first one primary again", async () => {
  const client = await athlete();
  const { ride, watch } = await rideAndWatch(client);

  const change = { kind: "makePrimary", id: watch.id, previous: ride.id };
  await applyChange(client, change);
  assert.deepEqual(
    (await workouts(client)).map(({ id }) => id),
    [watch.id],
  );

  await applyChange(client, undoOf(change));
  assert.deepEqual(
    (await workouts(client)).map(({ id }) => id),
    [ride.id],
  );
});

test("saying a source is not the same workout is undone by linking it back", async () => {
  const client = await athlete();
  const { ride, watch } = await rideAndWatch(client);

  const change = { kind: "unlink", id: watch.id, from: ride.id };
  await applyChange(client, change);
  assert.deepEqual((await workouts(client)).map(({ id }) => id).sort(), [ride.id, watch.id].sort());

  await applyChange(client, undoOf(change));
  const [only, ...rest] = await workouts(client);
  assert.deepEqual(rest, []);
  assert.equal(only.id, ride.id);
  assert.deepEqual(
    only.duplicates.map(({ id }) => id),
    [watch.id],
  );
});

test("a watch file with a wrong clock is found by search, linked by hand, and separated again by undo", async () => {
  const client = await athlete();
  const ride = await client.activities.upload({
    file: fit(rideRecording),
    source: "trainstack",
    sport: "indoor_cycling",
  });
  const nextDay = await client.activities.upload({
    file: fit({ ...watchRecording, start: "2026-10-02T07:00:00Z" }),
    source: "upload",
  });
  const wrongClock = await client.activities.upload({
    file: fit({ ...watchRecording, start: "2025-01-01T00:00:00Z" }),
    source: "upload",
  });
  assert.equal(wrongClock.primary, true, "the server cannot match a file with a wrong clock");

  const near = await client.activities.list({ ...nearWindow(ride), onePerWorkout: true });
  assert.deepEqual(
    linkCandidates(ride, near.activities, null).near.map(({ id }) => id),
    [nextDay.id],
    "only activities within a day are offered without a search, nearest first",
  );

  const search = async (text) => {
    const query = linkSearchText(text);
    const { activities } = await client.activities.list({ query, onePerWorkout: true });
    return linkCandidates(ride, near.activities, activities).matches.map(({ id }) => id);
  };
  assert.equal(linkSearchText("   "), null, "a blank search shows what is near");
  assert.deepEqual(
    (await search("  CYCL ")).sort(),
    [nextDay.id, wrongClock.id].sort(),
    "the search matches the sport, in any case, and leaves out the activity's own workout",
  );
  assert.deepEqual(await search("running"), []);

  const change = { kind: "link", id: ride.id, to: wrongClock.id, joining: membersOf(wrongClock) };
  await applyChange(client, change);
  const linked = await client.activities.get({ id: ride.id });
  assert.deepEqual(
    linked.duplicates.map(({ id }) => id),
    [wrongClock.id],
  );
  const { activities: rides } = await client.activities.list({ query: "cycling" });
  assert.deepEqual(
    linkCandidates(linked, [], rides).matches.map(({ id }) => id),
    [nextDay.id],
    "a source already in the workout is not offered again",
  );

  await applyChange(client, undoOf(change));
  assert.deepEqual(
    (await workouts(client)).map(({ id }) => id).sort(),
    [ride.id, nextDay.id, wrongClock.id].sort(),
  );
});

test("undoing a link to a workout of two sources keeps those two together", async () => {
  const client = await athlete();
  const { ride, watch } = await rideAndWatch(client);
  const other = await client.activities.upload({
    file: fit({ ...watchRecording, start: "2025-01-01T00:00:00Z" }),
    source: "upload",
  });

  const workout = await client.activities.get({ id: ride.id });
  const change = { kind: "link", id: other.id, to: ride.id, joining: membersOf(workout) };
  await applyChange(client, change);
  assert.equal((await workouts(client)).length, 1);

  await applyChange(client, undoOf(change));
  const after = await workouts(client);
  assert.equal(after.length, 2);
  const together = after.find((entry) => entry.id !== other.id);
  assert.deepEqual(membersOf(together).sort(), [ride.id, watch.id].sort());
});

test("deleting the primary source says what goes and what stays, and the workout keeps the other source", async () => {
  const client = await athlete();
  const { ride, watch } = await rideAndWatch(client);
  const primary = await client.activities.get({ id: ride.id });

  assert.deepEqual(deletingSource(primary), {
    what: "Only this file from Ride is deleted. It will not be added again, from Ride or by uploading the same file.",
    stays: "The workout stays, with Uploaded FIT file as its only source.",
  });
  assert.equal(
    deletingSource(await client.activities.get({ id: watch.id })).stays,
    "The workout stays, with Ride as its primary source.",
  );

  await client.activities.delete({ id: ride.id });
  const [only, ...rest] = await workouts(client);
  assert.deepEqual(rest, []);
  assert.equal(only.id, watch.id);
  assert.deepEqual(only.duplicates, []);
});
