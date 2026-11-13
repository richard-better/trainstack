import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isDefinedError, safe } from "@orpc/client";
import { mockApple } from "./helpers/apple.mjs";
import { api, migrate, rpcClient, send, startWorker } from "./helpers/worker.mjs";

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

const at = (minute) => new Date(Date.UTC(2026, 10, 13, 9, minute));

async function athleteWith(...names) {
  const signedIn = await apple.signIn(runtime, { email: `${randomUUID()}@example.com` });
  const client = rpcClient(runtime, { token: signedIn.token });
  const ids = {};
  for (const name of names) {
    ids[name] = randomUUID();
    await client.workouts.put({
      id: ids[name],
      workout: {
        name,
        sport: "cycling",
        steps: [{ type: "step", duration: { type: "time", seconds: 600 } }],
      },
      updatedAt: at(0),
    });
  }
  return { ...signedIn, client, ids };
}

async function definedError(promise, code) {
  const [error] = await safe(promise);
  assert.ok(isDefinedError(error), `expected ${code}, got ${error}`);
  assert.equal(error.code, code);
  return error;
}

test("an athlete groups workouts into named lists and orders them", async () => {
  const { client, ids } = await athleteWith("A", "B", "C", "D");
  const named = (list) =>
    list.workoutIds.map((id) => Object.keys(ids).find((name) => ids[name] === id));
  const base = randomUUID();
  const created = await client.workoutLists.put({ id: base, name: "Base block", updatedAt: at(0) });
  assert.deepEqual(created, {
    id: base,
    name: "Base block",
    workoutIds: [],
    createdAt: created.createdAt,
    updatedAt: at(0),
  });

  const place = (name, afterName, minute) =>
    client.workoutLists.place({
      id: base,
      workoutId: ids[name],
      after: afterName === null ? null : ids[afterName],
      updatedAt: at(minute),
    });
  assert.deepEqual(named(await place("A", null, 1)), ["A"]);
  assert.deepEqual(named(await place("B", "A", 2)), ["A", "B"]);
  assert.deepEqual(named(await place("C", "A", 3)), ["A", "C", "B"], "after A, before B");
  assert.deepEqual(named(await place("D", null, 4)), ["D", "A", "C", "B"], "first");
  assert.deepEqual(named(await place("D", "B", 5)), ["A", "C", "B", "D"], "moved to the end");
  assert.deepEqual(named(await place("B", null, 6)), ["B", "A", "C", "D"], "moved to the start");
  assert.deepEqual(named(await place("A", "C", 7)), ["B", "C", "A", "D"], "moved down one");
  for (let minute = 8; minute < 70; minute++) {
    await place(minute % 2 ? "C" : "A", "B", minute);
  }
  assert.deepEqual(
    named(await client.workoutLists.get({ id: base })),
    ["B", "C", "A", "D"],
    "positions never run out",
  );
  assert.deepEqual(
    named(
      await client.workoutLists.place({
        id: base,
        workoutId: ids.A,
        after: randomUUID(),
        updatedAt: at(70),
      }),
    ),
    ["B", "C", "D", "A"],
    "after a workout not in the list means last",
  );

  const [itself] = await safe(
    client.workoutLists.place({ id: base, workoutId: ids.A, after: ids.A, updatedAt: at(71) }),
  );
  assert.equal(itself.status, 400);

  const favourites = randomUUID();
  await client.workoutLists.put({ id: favourites, name: "Favourites", updatedAt: at(0) });
  await client.workoutLists.place({
    id: favourites,
    workoutId: ids.A,
    after: null,
    updatedAt: at(1),
  });
  const renamed = await client.workoutLists.put({
    id: favourites,
    name: "Favorites",
    updatedAt: at(2),
  });
  assert.equal(renamed.name, "Favorites");
  assert.deepEqual(named(renamed), ["A"], "a workout is in several lists");

  const removed = await client.workoutLists.remove({
    id: base,
    workoutId: ids.C,
    updatedAt: at(80),
  });
  assert.deepEqual(named(removed), ["B", "D", "A"]);

  assert.deepEqual(
    (await client.workoutLists.list({})).lists.map((list) => [list.name, named(list)]),
    [
      ["Base block", ["B", "D", "A"]],
      ["Favorites", ["A"]],
    ],
  );
});

test("deleting a workout takes it out of every list; deleting a list keeps its workouts", async () => {
  const { client, ids } = await athleteWith("A", "B");
  const one = randomUUID();
  const two = randomUUID();
  for (const id of [one, two]) {
    await client.workoutLists.put({ id, name: "List", updatedAt: at(0) });
    await client.workoutLists.place({ id, workoutId: ids.A, after: null, updatedAt: at(1) });
    await client.workoutLists.place({ id, workoutId: ids.B, after: ids.A, updatedAt: at(1) });
  }
  const { cursor } = await client.workoutLists.changes({});
  await client.workouts.delete({ id: ids.A });
  assert.deepEqual((await client.workoutLists.get({ id: one })).workoutIds, [ids.B]);
  assert.deepEqual((await client.workoutLists.get({ id: two })).workoutIds, [ids.B]);
  assert.deepEqual(
    (await client.workoutLists.changes({ since: cursor })).lists.map((list) => list.id).toSorted(),
    [one, two].toSorted(),
    "devices hear that both lists changed",
  );
  await definedError(
    client.workoutLists.place({ id: one, workoutId: ids.A, after: null, updatedAt: at(9) }),
    "WORKOUT_DELETED",
  );

  const { deletedAt } = await client.workoutLists.delete({ id: one });
  const gone = await definedError(client.workoutLists.get({ id: one }), "LIST_DELETED");
  assert.deepEqual(gone.data, { id: one, deletedAt });
  await definedError(
    client.workoutLists.put({ id: one, name: "Renamed offline", updatedAt: at(9) }),
    "LIST_DELETED",
  );
  await definedError(
    client.workoutLists.place({ id: one, workoutId: ids.B, after: null, updatedAt: at(9) }),
    "LIST_DELETED",
  );
  assert.equal((await client.workouts.get({ id: ids.B })).name, "B");
  assert.deepEqual(
    (await client.workoutLists.list({})).lists.map((list) => list.id),
    [two],
  );

  await definedError(
    client.workoutLists.place({
      id: randomUUID(),
      workoutId: ids.B,
      after: null,
      updatedAt: at(9),
    }),
    "NOT_FOUND",
  );
  await definedError(
    client.workoutLists.place({ id: two, workoutId: randomUUID(), after: null, updatedAt: at(9) }),
    "NOT_FOUND",
  );
});

test("an add and a removal on two devices settle on the later one, in either order", async () => {
  for (const [first, second] of [
    ["add", "remove"],
    ["remove", "add"],
  ]) {
    for (const laterIs of ["add", "remove"]) {
      const { client, ids } = await athleteWith("A");
      const id = randomUUID();
      await client.workoutLists.put({ id, name: "List", updatedAt: at(0) });
      const writes = {
        add: () =>
          client.workoutLists.place({
            id,
            workoutId: ids.A,
            after: null,
            updatedAt: at(laterIs === "add" ? 2 : 1),
          }),
        remove: () =>
          client.workoutLists.remove({
            id,
            workoutId: ids.A,
            updatedAt: at(laterIs === "remove" ? 2 : 1),
          }),
      };
      await writes[first]();
      await writes[second]();
      assert.deepEqual(
        (await client.workoutLists.get({ id })).workoutIds,
        laterIs === "add" ? [ids.A] : [],
        `${first} then ${second}, the later being ${laterIs}`,
      );
    }
  }
});

test("a renaming converges on the later name, and a replayed write changes nothing", async () => {
  const { client, ids } = await athleteWith("A", "B");
  const id = randomUUID();
  await client.workoutLists.put({ id, name: "Second", updatedAt: at(2) });
  const stale = await client.workoutLists.put({ id, name: "First", updatedAt: at(1) });
  assert.equal(stale.name, "Second", "a stale rename learns what won");

  await client.workoutLists.place({ id, workoutId: ids.A, after: null, updatedAt: at(3) });
  const move = { id, workoutId: ids.B, after: ids.A, updatedAt: at(4) };
  await client.workoutLists.place(move);
  await client.workoutLists.place({ id, workoutId: ids.B, after: null, updatedAt: at(5) });
  const { cursor } = await client.workoutLists.changes({});

  const replayed = await client.workoutLists.place(move);
  assert.deepEqual(replayed.workoutIds, [ids.B, ids.A], "an older move does not undo a newer one");
  await client.workoutLists.put({ id, name: "Second", updatedAt: at(2) });
  assert.deepEqual(await client.workoutLists.changes({ since: cursor }), {
    lists: [],
    deleted: [],
    cursor,
  });

  const { deletedAt } = await client.workoutLists.delete({ id });
  const changes = await client.workoutLists.changes({ since: cursor });
  assert.deepEqual(changes.lists, []);
  assert.deepEqual(changes.deleted, [{ id, deletedAt }]);
});

test("the app manages lists over plain HTTP", async () => {
  const { token, ids } = await athleteWith("A");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const id = randomUUID();
  const post = (path, body) =>
    send(
      runtime,
      new Request(`${api}/api-reference${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
  assert.equal(
    (await post(`/workout-lists/${id}`, { name: "Plan", updatedAt: at(0).toISOString() })).status,
    200,
  );
  const placed = await post(`/workout-lists/${id}/entries`, {
    workoutId: ids.A,
    after: null,
    updatedAt: at(1).toISOString(),
  });
  assert.equal(placed.status, 200, await placed.clone().text());
  assert.deepEqual((await placed.json()).workoutIds, [ids.A]);
  const removed = await post(`/workout-lists/${id}/entries/remove`, {
    workoutId: ids.A,
    updatedAt: at(2).toISOString(),
  });
  assert.deepEqual((await removed.json()).workoutIds, []);
  const listed = await runtime.dispatchFetch(`${api}/api-reference/workout-lists`, { headers });
  assert.deepEqual(
    (await listed.json()).lists.map((list) => list.name),
    ["Plan"],
  );
  const changes = await runtime.dispatchFetch(
    `${api}/api-reference/workout-lists/changes?since=0`,
    {
      headers,
    },
  );
  assert.equal(changes.status, 200);
  const deleted = await runtime.dispatchFetch(`${api}/api-reference/workout-lists/${id}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(deleted.status, 200);
});
