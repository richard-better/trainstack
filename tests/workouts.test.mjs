import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { isDefinedError, safe } from "@orpc/client";
import { flatten } from "../packages/workout/src/index.ts";
import { mockApple } from "./helpers/apple.mjs";
import { api, migrate, rpcClient, send, startWorker } from "./helpers/worker.mjs";

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
  return { ...signedIn, client: rpcClient(runtime, { token: signedIn.token }) };
}

const at = (minute) => new Date(Date.UTC(2026, 10, 13, 9, minute));

const steady = (seconds, value) => ({
  type: "step",
  duration: { type: "time", seconds },
  target: { type: "power", unit: "ftp", level: { kind: "constant", value } },
});

const workoutNamed = (name, overrides = {}) => ({
  name,
  sport: "cycling",
  steps: [steady(600, 0.6)],
  ...overrides,
});

const fixture = (name) => readFileSync(`packages/workout/test/fixtures/${name}`, "utf8");

async function definedError(promise, code) {
  const [error] = await safe(promise);
  assert.ok(isDefinedError(error), `expected ${code}, got ${error}`);
  assert.equal(error.code, code);
  return error;
}

test("an athlete creates, reads, changes and deletes a workout", async () => {
  const { client } = await athlete();
  const id = randomUUID();
  const sweetSpot = workoutNamed("Sweet spot", {
    description: "Two blocks",
    focus: "tempo",
    tags: ["base"],
    steps: [
      steady(600, 0.5),
      { type: "repeat", count: 2, steps: [steady(900, 0.9), steady(300, 0.5)] },
    ],
  });

  const created = await client.workouts.put({ id, workout: sweetSpot, updatedAt: at(0) });
  assert.deepEqual(created, {
    id,
    name: "Sweet spot",
    sport: "cycling",
    focus: "tempo",
    description: "Two blocks",
    author: null,
    tags: ["base"],
    totals: { seconds: 3000, meters: 0 },
    origin: null,
    createdAt: created.createdAt,
    updatedAt: at(0),
    workout: sweetSpot,
  });
  assert.deepEqual(await client.workouts.get({ id }), created);

  const longer = {
    ...sweetSpot,
    name: "Sweet spot 3x15",
    steps: [...sweetSpot.steps, steady(900, 0.9)],
  };
  const changed = await client.workouts.put({ id, workout: longer, updatedAt: at(1) });
  assert.equal(changed.name, "Sweet spot 3x15");
  assert.deepEqual(changed.totals, { seconds: 3900, meters: 0 });
  assert.deepEqual(changed.createdAt, created.createdAt);
  assert.deepEqual((await client.workouts.get({ id })).workout, longer);

  const deleted = await client.workouts.delete({ id });
  assert.equal(deleted.id, id);
  const gone = await definedError(client.workouts.get({ id }), "WORKOUT_DELETED");
  assert.equal(gone.status, 410);
  assert.deepEqual(gone.data, deleted);
  assert.deepEqual((await client.workouts.list({})).workouts, []);
  assert.deepEqual(await client.workouts.delete({ id }), deleted, "deleting again changes nothing");

  await definedError(client.workouts.get({ id: randomUUID() }), "NOT_FOUND");
});

test("a workout the model refuses is INVALID_WORKOUT, and one too big or edited in the future, is not stored", async () => {
  const { client } = await athlete();
  const id = randomUUID();

  const empty = await definedError(
    client.workouts.put({
      id,
      workout: { name: "Empty", sport: "cycling", steps: [] },
      updatedAt: at(0),
    }),
    "INVALID_WORKOUT",
  );
  assert.equal(empty.status, 422);
  assert.match(empty.data.reason, /^workout\.steps: /);
  const rowing = await definedError(
    client.workouts.put({
      id,
      workout: workoutNamed("Row", { sport: "rowing" }),
      updatedAt: at(0),
    }),
    "INVALID_WORKOUT",
  );
  assert.match(rowing.data.reason, /^workout\.sport: /);

  const lateCue = workoutNamed("Late cue", {
    steps: [
      {
        type: "repeat",
        count: 2,
        steps: [steady(60, 1)],
        cues: [{ at: { type: "time", seconds: 600 }, text: "Go" }],
      },
    ],
  });
  const unplaceable = await definedError(
    client.workouts.put({ id, workout: lateCue, updatedAt: at(0) }),
    "INVALID_WORKOUT",
  );
  assert.equal(
    unplaceable.data.reason,
    "workout.steps: A cue 600 seconds into a repeat comes after the repeat ends",
  );

  const [badId] = await safe(
    client.workouts.put({ id: "not-a-uuid", workout: workoutNamed("Fine"), updatedAt: at(0) }),
  );
  assert.equal(badId.code, "BAD_REQUEST", "only the workout's own faults are INVALID_WORKOUT");

  const huge = workoutNamed("Huge", {
    steps: Array.from({ length: 2000 }, (_, i) => ({
      ...steady(60, 0.5),
      notes: `${i} ${"x".repeat(150)}`,
    })),
  });
  const tooLarge = await definedError(
    client.workouts.put({ id, workout: huge, updatedAt: at(0) }),
    "WORKOUT_TOO_LARGE",
  );
  assert.equal(tooLarge.status, 413);

  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  await definedError(
    client.workouts.put({ id, workout: workoutNamed("Later"), updatedAt: tomorrow }),
    "EDITED_IN_THE_FUTURE",
  );
  await definedError(client.workouts.get({ id }), "NOT_FOUND");
});

test("an athlete searches by words and filters by sport, focus and duration", async () => {
  const { client } = await athlete();
  const put = (name, overrides) =>
    client.workouts.put({
      id: randomUUID(),
      workout: workoutNamed(name, overrides),
      updatedAt: at(0),
    });
  const vo2 = await put("VO2 max booster", { focus: "vo2Max", steps: [steady(2700, 1.1)] });
  const tempo = await put("Zone 3 · 3×10", {
    focus: "tempo",
    description: "Steady, honest work",
    steps: [steady(3600, 0.85)],
  });
  const run = await put("Tempo run", {
    sport: "running",
    focus: "tempo",
    author: "Coach Zoë",
    tags: ["Marathon block"],
    steps: [{ type: "step", duration: { type: "distance", meters: 8000 } }],
  });
  const recovery = await put("Récupération", { focus: "recovery", steps: [steady(1800, 0.5)] });

  const names = async (input) =>
    (await client.workouts.list({ sort: "name", ...input })).workouts.map((w) => w.name);

  assert.deepEqual(await names({}), [
    "Récupération",
    "Tempo run",
    "VO2 max booster",
    "Zone 3 · 3×10",
  ]);
  assert.deepEqual(await names({ query: "TEMPO" }), ["Tempo run"]);
  assert.deepEqual(await names({ query: "3x10" }), ["Zone 3 · 3×10"], "× is searched as x");
  assert.deepEqual(await names({ query: "recuperation" }), ["Récupération"], "accents are ignored");
  assert.deepEqual(await names({ query: "zoe" }), ["Tempo run"], "the author is searched");
  assert.deepEqual(await names({ query: "marathon" }), ["Tempo run"], "tags are searched");
  assert.deepEqual(
    await names({ query: "steady honest" }),
    ["Zone 3 · 3×10"],
    "every word must match",
  );
  assert.deepEqual(await names({ query: "steady marathon" }), []);
  assert.deepEqual(await names({ query: "100%" }), [], "a query is text, not a pattern");
  assert.deepEqual(await names({ sport: "running" }), ["Tempo run"]);
  assert.deepEqual(await names({ focus: "tempo" }), ["Tempo run", "Zone 3 · 3×10"]);
  assert.deepEqual(await names({ minSeconds: 1800, maxSeconds: 2700 }), [
    "Récupération",
    "VO2 max booster",
  ]);
  assert.deepEqual(
    (await client.workouts.list({ sort: "duration" })).workouts.map((w) => w.id),
    [run.id, recovery.id, vo2.id, tempo.id],
  );
  const listed = (await client.workouts.list({ query: "tempo run" })).workouts;
  assert.deepEqual(listed, [
    {
      id: run.id,
      name: "Tempo run",
      sport: "running",
      focus: "tempo",
      description: null,
      author: "Coach Zoë",
      tags: ["Marathon block"],
      totals: { seconds: 0, meters: 8000 },
      origin: null,
      createdAt: run.createdAt,
      updatedAt: at(0),
    },
  ]);

  const other = await athlete();
  assert.deepEqual((await other.client.workouts.list({})).workouts, []);
  await definedError(other.client.workouts.get({ id: run.id }), "NOT_FOUND");
});

test("every sort pages through the whole library with a cursor, once each", async () => {
  const { client } = await athlete();
  const ids = [];
  for (let i = 0; i < 7; i++) {
    const { id } = await client.workouts.put({
      id: randomUUID(),
      workout: workoutNamed(`Workout ${i % 3}`, { steps: [steady(600 * (i % 2) + 60, 0.5)] }),
      updatedAt: at(i % 4),
    });
    ids.push(id);
  }
  for (const sort of ["updated", "name", "duration"]) {
    const whole = (await client.workouts.list({ sort, limit: 200 })).workouts.map((w) => w.id);
    const paged = [];
    let cursor;
    do {
      const page = await client.workouts.list({ sort, limit: 2, cursor });
      paged.push(...page.workouts.map((w) => w.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.deepEqual(paged, whole, `${sort} pages match the whole list`);
    assert.deepEqual(paged.toSorted(), ids.toSorted());
  }
  const page = await client.workouts.list({ sort: "name", limit: 2 });
  const [mismatched] = await safe(
    client.workouts.list({ sort: "duration", cursor: page.nextCursor }),
  );
  assert.equal(mismatched.status, 400);
  const [garbage] = await safe(client.workouts.list({ cursor: "not a cursor" }));
  assert.equal(garbage.status, 400);
});

test("two devices editing one workout converge on the later edit, in either order", async () => {
  for (const order of [
    [0, 1],
    [1, 0],
  ]) {
    const { client } = await athlete();
    const id = randomUUID();
    const edits = [
      { id, workout: workoutNamed("From the phone"), updatedAt: at(5) },
      { id, workout: workoutNamed("From the web"), updatedAt: at(6) },
    ];
    const responses = [];
    for (const index of order) responses.push(await client.workouts.put(edits[index]));
    assert.equal((await client.workouts.get({ id })).name, "From the web");
    assert.equal(responses.at(-1).name, "From the web", "a losing write learns what won");
  }
});

test("two edits stamped the same moment converge on the same one, in either order", async () => {
  const winners = [];
  for (const names of [
    ["Alpha", "Bravo"],
    ["Bravo", "Alpha"],
  ]) {
    const { client } = await athlete();
    const id = randomUUID();
    for (const name of names)
      await client.workouts.put({ id, workout: workoutNamed(name), updatedAt: at(3) });
    winners.push((await client.workouts.get({ id })).name);
  }
  assert.equal(winners[0], winners[1]);
});

test("an edit racing a delete ends deleted in either order, and the late edit is told", async () => {
  const { client } = await athlete();

  const first = randomUUID();
  await client.workouts.put({
    id: first,
    workout: workoutNamed("Edited then deleted"),
    updatedAt: at(0),
  });
  await client.workouts.put({ id: first, workout: workoutNamed("Edit"), updatedAt: at(9) });
  await client.workouts.delete({ id: first });
  await definedError(client.workouts.get({ id: first }), "WORKOUT_DELETED");

  const second = randomUUID();
  await client.workouts.put({
    id: second,
    workout: workoutNamed("Deleted then edited"),
    updatedAt: at(0),
  });
  const { deletedAt } = await client.workouts.delete({ id: second });
  const refused = await definedError(
    client.workouts.put({ id: second, workout: workoutNamed("Offline edit"), updatedAt: at(9) }),
    "WORKOUT_DELETED",
  );
  assert.deepEqual(refused.data, { id: second, deletedAt });
  await definedError(client.workouts.get({ id: second }), "WORKOUT_DELETED");

  const neverSeen = randomUUID();
  await client.workouts.delete({ id: neverSeen });
  await definedError(
    client.workouts.put({
      id: neverSeen,
      workout: workoutNamed("Created offline"),
      updatedAt: at(0),
    }),
    "WORKOUT_DELETED",
    "a delete that arrives before its create still wins",
  );
});

test("a replayed write changes nothing, and a device syncs only what changed since its cursor", async () => {
  const { client } = await athlete();
  const id = randomUUID();
  const write = { id, workout: workoutNamed("Replayed"), updatedAt: at(0) };
  const first = await client.workouts.put(write);
  const { cursor } = await client.workouts.changes({});
  assert.deepEqual(await client.workouts.put(write), first);
  assert.deepEqual(await client.workouts.changes({ since: cursor }), {
    workouts: [],
    deleted: [],
    cursor,
  });
  const stale = await client.workouts.put({
    ...write,
    workout: workoutNamed("Older"),
    updatedAt: at(-1),
  });
  assert.equal(stale.name, "Replayed");
  assert.deepEqual((await client.workouts.changes({ since: cursor })).workouts, []);

  const other = randomUUID();
  const added = await client.workouts.put({
    id: other,
    workout: workoutNamed("New"),
    updatedAt: at(1),
  });
  const { deletedAt } = await client.workouts.delete({ id });
  const changes = await client.workouts.changes({ since: cursor });
  assert.deepEqual(changes.workouts, [added]);
  assert.deepEqual(changes.deleted, [{ id, deletedAt }]);
  assert.deepEqual(await client.workouts.changes({ since: changes.cursor }), {
    workouts: [],
    deleted: [],
    cursor: changes.cursor,
  });
  const everything = await client.workouts.changes({});
  assert.deepEqual(everything.workouts, [added]);
  assert.deepEqual(everything.deleted, [{ id, deletedAt }]);
});

test("a .zwo, .erg or .mrc file becomes a stored workout, with the reader's warnings", async () => {
  const { client } = await athlete();
  const zwo = await client.workouts.import({
    file: new File([fixture("threshold-builder.zwo")], "threshold-builder.zwo"),
    id: randomUUID(),
    updatedAt: at(0),
  });
  assert.equal(zwo.workout.name, "Threshold builder & sprints");
  assert.equal(zwo.workout.author, "TrainStack Coaching");
  assert.deepEqual(zwo.workout.origin, {
    kind: "file",
    format: "zwo",
    fileName: "threshold-builder.zwo",
  });
  assert.deepEqual(await client.workouts.get({ id: zwo.workout.id }), zwo.workout);

  const erg = await client.workouts.import({
    file: new File([fixture("sweet-spot.erg")], "Sweet Spot.ERG"),
    id: randomUUID(),
    updatedAt: at(0),
  });
  assert.equal(erg.workout.name, "Sweet spot 2x15");
  assert.deepEqual(erg.workout.totals, { seconds: 3000, meters: 0 });
  assert.equal(erg.workout.workout.steps[0].target.unit, "watts");

  const mrc = await client.workouts.import({
    file: new File([fixture("over-unders.mrc")], "over-unders.mrc"),
    id: randomUUID(),
    updatedAt: at(0),
  });
  assert.equal(mrc.workout.origin.format, "mrc");

  const tempoRun = await client.workouts.import({
    file: new File([fixture("tempo-run.zwo")], "tempo-run.zwo"),
    id: randomUUID(),
    updatedAt: at(0),
  });
  assert.equal(tempoRun.workout.sport, "running");
  assert.deepEqual(tempoRun.warnings, []);

  const odd = await client.workouts.import({
    file: new File(
      [
        `<workout_file><name>Odd</name><category>Custom</category><sportType>run</sportType><workout><SteadyState Duration="600" Power="0.9" pace="2"/></workout></workout_file>`,
      ],
      "odd.zwo",
    ),
    id: randomUUID(),
    updatedAt: at(0),
  });
  assert.deepEqual(odd.warnings, [
    { code: "dropped", message: "<category> is not supported", at: "line 1" },
    {
      code: "dropped",
      message: "Zwift reference pace 2 is read as a share of threshold pace",
      at: "<SteadyState> on line 1",
    },
  ]);
});

test("a file the readers refuse comes back as a typed error listing every issue", async () => {
  const { client } = await athlete();
  const id = randomUUID();
  const broken = await definedError(
    client.workouts.import({
      file: new File(["<workout_file><workout><SteadyState Power='x'/></workout>"], "broken.zwo"),
      id,
      updatedAt: at(0),
    }),
    "WORKOUT_FORMAT_ERROR",
  );
  assert.equal(broken.status, 422);
  assert.equal(broken.data.format, "zwo");
  assert.ok(broken.data.issues.length > 0);
  assert.ok(
    broken.data.issues.every((issue) => issue.code === "malformed" || issue.code === "unsupported"),
  );

  const unsupported = await definedError(
    client.workouts.import({ file: new File(["x"], "ride.gpx"), id, updatedAt: at(0) }),
    "WORKOUT_FORMAT_ERROR",
  );
  assert.deepEqual(unsupported.data, {
    format: null,
    issues: [{ code: "unsupported", message: '"ride.gpx" is not a .zwo, .erg, .mrc or .fit file' }],
  });

  const [tooBig] = await safe(
    client.workouts.import({
      file: new File(["x".repeat(1024 * 1024 + 1)], "big.erg"),
      id,
      updatedAt: at(0),
    }),
  );
  assert.equal(tooBig.status, 400, "a file over 1 MiB is refused before it is read");

  const billion = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]><workout_file><name>&lol2;</name><workout><SteadyState Duration="60" Power="0.5"/></workout></workout_file>`;
  const [entities] = await safe(
    client.workouts.import({ file: new File([billion], "lol.zwo"), id, updatedAt: at(0) }),
  );
  assert.ok(entities, "entity declarations are not expanded");
  assert.equal(entities.code, "WORKOUT_FORMAT_ERROR");
  await definedError(client.workouts.get({ id }), "NOT_FOUND");
});

test("a stored workout comes out in each format and reads back to the same steps", async () => {
  const { client } = await athlete();
  const id = randomUUID();
  const workout = workoutNamed("Over-unders 2×10", {
    focus: "threshold",
    steps: [
      steady(600, 0.5),
      { type: "repeat", count: 3, steps: [steady(120, 1.04), steady(180, 0.72)] },
      steady(300, 0.5),
    ],
  });
  await client.workouts.put({ id, workout, updatedAt: at(0) });

  for (const format of ["zwo", "mrc", "erg"]) {
    const exported = await client.workouts.export({ id, format, ftp: 250 });
    assert.equal(exported.fileName, `over-unders-2x10.${format}`);
    assert.ok(exported.text.length > 0);
    const back = await client.workouts.import({
      file: new File([exported.text], exported.fileName),
      id: randomUUID(),
      updatedAt: at(0),
    });
    const toFtp = (step) =>
      step.target.unit === "watts"
        ? {
            ...step.target,
            unit: "ftp",
            level: { kind: "constant", value: step.target.level.value / 250 },
          }
        : step.target;
    assert.deepEqual(
      flatten(back.workout.workout.steps).map((step) => [step.duration, toFtp(step)]),
      flatten(workout.steps).map((step) => [step.duration, step.target]),
      `${format} keeps the timeline`,
    );
  }
  const zwo = await client.workouts.export({ id, format: "zwo" });
  assert.equal(zwo.contentType, "application/xml");
  assert.deepEqual(
    zwo.warnings.map((warning) => warning.code),
    ["dropped"],
    "the focus has nowhere to go",
  );

  const needsFtp = await definedError(
    client.workouts.export({ id, format: "erg" }),
    "WORKOUT_FORMAT_ERROR",
  );
  assert.equal(needsFtp.data.format, "erg");
  assert.ok(needsFtp.data.issues.length > 0);

  const run = randomUUID();
  await client.workouts.put({
    id: run,
    workout: workoutNamed("Long run", {
      sport: "running",
      steps: [{ type: "step", duration: { type: "distance", meters: 10000 } }],
    }),
    updatedAt: at(0),
  });
  const distance = await definedError(
    client.workouts.export({ id: run, format: "mrc" }),
    "WORKOUT_FORMAT_ERROR",
  );
  assert.equal(distance.data.issues[0].code, "unsupported");
});

test("the app reads, writes and exports workouts over plain HTTP with a bearer token", async () => {
  const { token } = await athlete();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const id = randomUUID();
  const fromSwift = workoutNamed("From Swift", {
    steps: [
      {
        type: "repeat",
        count: 2,
        name: "Sets",
        steps: [
          { type: "repeat", count: 3, steps: [steady(30, 1.2), steady(30, 0.5)] },
          steady(300, 0.5),
        ],
      },
    ],
  });
  const written = await send(
    runtime,
    new Request(`${api}/api-reference/workouts/${id}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workout: fromSwift,
        updatedAt: "2026-11-13T09:00:00.000Z",
      }),
    }),
  );
  assert.equal(written.status, 200, await written.clone().text());
  assert.equal((await written.json()).updatedAt, "2026-11-13T09:00:00.000Z");

  const fetched = await runtime.dispatchFetch(`${api}/api-reference/workouts/${id}`, { headers });
  assert.equal(fetched.status, 200);
  assert.deepEqual((await fetched.json()).workout, fromSwift, "nested repeats survive JSON");

  const spec = await (await runtime.dispatchFetch(`${api}/api-reference/spec.json`)).json();
  for (const path of [
    "/workouts",
    "/workouts/{id}",
    "/workouts/changes",
    "/workouts/import",
    "/workouts/{id}/export",
    "/builtin-workouts",
    "/builtin-workouts/{id}",
    "/builtin-workouts/{id}/copy",
    "/builtin-workouts/{id}/export",
    "/workout-lists",
    "/workout-lists/{id}",
    "/workout-lists/{id}/entries",
    "/workout-lists/{id}/entries/remove",
    "/workout-lists/changes",
  ]) {
    assert.ok(spec.paths[path], `${path} is in the OpenAPI reference`);
  }

  const listed = await runtime.dispatchFetch(
    `${api}/api-reference/workouts?query=swift&sort=name`,
    { headers },
  );
  assert.deepEqual(
    (await listed.json()).workouts.map((w) => w.id),
    [id],
  );

  const changes = await runtime.dispatchFetch(`${api}/api-reference/workouts/changes?since=0`, {
    headers,
  });
  assert.equal(changes.status, 200);
  assert.equal((await changes.json()).workouts[0].id, id);

  const exported = await runtime.dispatchFetch(
    `${api}/api-reference/workouts/${id}/export?format=zwo`,
    {
      headers,
    },
  );
  assert.equal(exported.status, 200);
  assert.match((await exported.json()).text, /<workout_file>/);

  const form = new FormData();
  form.set("file", new File([fixture("sweet-spot.erg")], "sweet-spot.erg"));
  form.set("id", randomUUID());
  form.set("updatedAt", "2026-11-13T09:00:00.000Z");
  const imported = await send(
    runtime,
    new Request(`${api}/api-reference/workouts/import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }),
  );
  assert.equal(imported.status, 200, await imported.clone().text());
  assert.equal((await imported.json()).workout.name, "Sweet spot 2x15");

  const removed = await runtime.dispatchFetch(`${api}/api-reference/workouts/${id}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(removed.status, 200);
  const gone = await runtime.dispatchFetch(`${api}/api-reference/workouts/${id}`, { headers });
  assert.equal(gone.status, 410);
  assert.equal((await gone.json()).code, "WORKOUT_DELETED");

  const anonymous = await runtime.dispatchFetch(`${api}/api-reference/workouts`);
  assert.equal(anonymous.status, 401);
});

test("deleting an account deletes its workouts and lists, and leaves other accounts'", async () => {
  const ada = await athlete();
  const bob = await athlete();
  const adas = randomUUID();
  const bobs = randomUUID();
  await ada.client.workouts.put({ id: adas, workout: workoutNamed("Ada's"), updatedAt: at(0) });
  await ada.client.workouts.delete({ id: randomUUID() });
  const list = randomUUID();
  await ada.client.workoutLists.put({ id: list, name: "Base", updatedAt: at(0) });
  await ada.client.workoutLists.place({ id: list, workoutId: adas, after: null, updatedAt: at(0) });
  await bob.client.workouts.put({ id: bobs, workout: workoutNamed("Bob's"), updatedAt: at(0) });

  const deleted = await runtime.dispatchFetch(`${api}/api/auth/delete-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ada.token}` },
    body: JSON.stringify({}),
  });
  assert.equal(deleted.status, 200, await deleted.clone().text());

  for (const table of ["workout", "workout_list", "workout_list_entry"]) {
    const rows = await db
      .prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`)
      .bind(ada.user.id)
      .first();
    assert.equal(rows.n, 0, `${table} holds nothing of the deleted account`);
  }
  assert.equal((await bob.client.workouts.get({ id: bobs })).name, "Bob's");
});
