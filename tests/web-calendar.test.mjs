import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  anchorOf,
  meterOf,
  moved,
  nudged,
  periodOf,
  placementFor,
  positionAt,
  rangeKey,
  shiftedAnchor,
  spotOf,
  weekCopies,
  weeksOf,
} from "../hosted/apps/account/src/lib/calendar.ts";
import {
  createCalendarWrites,
  savePlannedWorkout,
} from "../hosted/apps/account/src/lib/calendar-writes.ts";
import { mockApple } from "./helpers/apple.mjs";
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
  const { token } = await apple.signIn(runtime, { email: `${randomUUID()}@example.com` });
  return { token, client: rpcClient(runtime, { token }) };
}

const ride = (name, minutes = 60) => ({
  kind: "workout",
  workout: {
    name,
    sport: "cycling",
    steps: [
      {
        type: "step",
        duration: { type: "time", seconds: minutes * 60 },
        target: { type: "power", unit: "watts", level: { kind: "constant", value: 200 } },
      },
    ],
  },
  source: null,
  notes: null,
});

const FROM = "2030-03-04";
const THROUGH = "2030-03-10";

function device(client, overrides = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = {
    calendar: client.calendar,
    plannedWorkouts: {
      get: (input) => client.plannedWorkouts.get(input),
      put: (input) => client.plannedWorkouts.put(input),
      move: (input) => client.plannedWorkouts.move(input),
      skip: (input) => client.plannedWorkouts.skip(input),
      delete: (input) => client.plannedWorkouts.delete(input),
      ...overrides,
    },
  };
  const writes = createCalendarWrites({
    queryClient,
    api,
    retryDelays: [5],
    whenOnline: () => () => {},
  });
  const load = () =>
    queryClient.fetchQuery({
      queryKey: rangeKey(FROM, THROUGH),
      queryFn: () => client.calendar.range({ from: FROM, through: THROUGH }),
    });
  const shown = () => writes.view(queryClient.getQueryData(rangeKey(FROM, THROUGH)));
  return { queryClient, writes, load, shown };
}

const namesOn = (range, day) =>
  range.days
    .find((entry) => entry.day === day)
    .planned.map((item) =>
      item.content.kind === "workout" ? item.content.workout.name : item.content.kind,
    );

async function planDay(client, day, names) {
  const items = [];
  for (const [index, name] of names.entries()) {
    items.push(
      await client.plannedWorkouts.put({
        id: randomUUID(),
        day,
        position: index,
        content: ride(name),
        updatedAt: new Date(),
      }),
    );
  }
  return items;
}

test("a month view runs Monday to Sunday over whole weeks, and a week view from its Monday", () => {
  const november = periodOf("month", "2026-11", "2026-11-14");
  assert.deepEqual(
    [november.from, november.through, november.label],
    ["2026-10-26", "2026-12-06", "November 2026"],
  );
  const february = periodOf("month", "2027-02", "2026-11-14");
  assert.deepEqual([february.from, february.through], ["2027-02-01", "2027-02-28"]);
  const week = periodOf("week", "2026-11-12", "2026-11-14");
  assert.deepEqual(
    [week.at, week.from, week.through, week.label],
    ["2026-11-09", "2026-11-09", "2026-11-15", "This week"],
  );
  assert.equal(shiftedAnchor(november, 2), "2027-01");
  assert.equal(shiftedAnchor(november, -11), "2025-12");
  assert.equal(shiftedAnchor(week, -1), "2026-11-02");
});

test("a link to a day that does not exist opens the period of today", () => {
  assert.equal(anchorOf("month", "2026-13", "2026-11-14"), "2026-11");
  assert.equal(anchorOf("week", "2026-02-30", "2026-11-14"), "2026-11-09");
  assert.equal(anchorOf("week", undefined, "2026-11-14"), "2026-11-09");
  assert.equal(anchorOf("month", "2026-03-18", "2026-11-14"), "2026-03", "a day picks its month");
  assert.equal(
    anchorOf("week", "2026-03", "2026-11-14"),
    "2026-02-23",
    "a month picks its first week",
  );
});

test("a drop lands between its neighbours, and a drop back on its own spot changes nothing", () => {
  assert.equal(positionAt([], 0), 0);
  assert.equal(positionAt([1, 2, 3], 0), 0);
  assert.equal(positionAt([1, 2, 3], 1), 1.5);
  assert.equal(positionAt([1, 2, 3], 9), 4);
  const planned = (id, position) => ({ id, position });
  const range = {
    today: "2030-03-05",
    days: [
      { day: "2030-03-04", planned: [planned("a", 0), planned("b", 1), planned("c", 2)] },
      { day: "2030-03-05", planned: [] },
    ],
    weeks: [],
  };
  assert.equal(placementFor(range, "b", "2030-03-04", 1), null);
  assert.deepEqual(placementFor(range, "c", "2030-03-04", 0), { day: "2030-03-04", position: -1 });
  assert.deepEqual(placementFor(range, "a", "2030-03-04", 2), { day: "2030-03-04", position: 3 });
  assert.deepEqual(placementFor(range, "a", "2030-03-05", 0), { day: "2030-03-05", position: 0 });

  const spot = spotOf(range, "b");
  assert.deepEqual(spot, { day: "2030-03-04", index: 1 });
  assert.deepEqual(nudged(range, "b", spot, "next-day"), { day: "2030-03-05", index: 0 });
  assert.deepEqual(nudged(range, "b", spot, "previous-day"), spot, "the first day is the edge");
  assert.deepEqual(nudged(range, "b", spot, "later"), { day: "2030-03-04", index: 2 });
  assert.deepEqual(nudged(range, "b", { ...spot, index: 2 }, "later"), {
    day: "2030-03-04",
    index: 2,
  });
});

test("a paired workout shows done, and moving it to another day lets go of its activity", () => {
  const paired = {
    id: "a",
    day: "2030-03-04",
    position: 0,
    content: ride("Spin"),
    skipped: { reason: null },
    pairing: { activityId: "f".repeat(64), by: "auto" },
    state: "completed",
  };
  assert.equal(moved(paired, { day: "2030-03-04", position: 5 }, "2030-03-10").state, "completed");
  const away = moved(paired, { day: "2030-03-05", position: 0 }, "2030-03-10");
  assert.deepEqual([away.pairing, away.state], [null, "skipped"]);
  const unskipped = moved(
    { ...paired, skipped: null },
    { day: "2030-03-05", position: 0 },
    "2030-03-10",
  );
  assert.equal(unskipped.state, "missed");
});

test("a week meter fills by what was done, and marks the plan when done passes it", () => {
  assert.deepEqual(meterOf(30, 60), { done: 30, planned: 60, fill: 0.5, mark: null });
  assert.deepEqual(meterOf(90, 60), { done: 90, planned: 60, fill: 1, mark: 60 / 90 });
  assert.deepEqual(meterOf(0, 0), { done: 0, planned: 0, fill: 0, mark: null });
});

test("a move shows at once, keeps its totals with it, and the server agrees", async () => {
  const { client } = await athlete();
  await planDay(client, "2030-03-04", ["Openers", "Threshold", "Spin"]);
  const { writes, load, shown } = device(client);
  const range = await load();
  const spin = range.days[0].planned[2];

  const moving = writes.move(spin, placementFor(range, spin.id, "2030-03-06", 0));
  const optimistic = shown();
  assert.deepEqual(namesOn(optimistic, "2030-03-04"), ["Openers", "Threshold"]);
  assert.deepEqual(namesOn(optimistic, "2030-03-06"), ["Spin"]);
  assert.equal(optimistic.days[0].totals.planned.seconds, 2 * 3600);
  assert.equal(optimistic.days[2].totals.planned.seconds, 3600);
  assert.equal(optimistic.weeks[0].totals.planned.seconds, 3 * 3600);
  await moving;
  await writes.settled();

  const fresh = await client.calendar.range({ from: FROM, through: THROUGH });
  assert.deepEqual(namesOn(fresh, "2030-03-06"), ["Spin"]);
  assert.deepEqual(namesOn(shown(), "2030-03-06"), ["Spin"]);
  assert.deepEqual(writes.notices(), []);

  const threshold = fresh.days[0].planned[1];
  await writes.move(threshold, placementFor(fresh, threshold.id, "2030-03-04", 0));
  const reordered = await client.calendar.range({ from: FROM, through: THROUGH });
  assert.deepEqual(namesOn(reordered, "2030-03-04"), ["Threshold", "Openers"]);
});

test("a move the server refuses rolls back and says why", async () => {
  const { client } = await athlete();
  await planDay(
    client,
    "2030-03-05",
    Array.from({ length: 20 }, (_, index) => `Session ${index + 1}`),
  );
  const [spin] = await planDay(client, "2030-03-04", ["Spin"]);
  const { writes, load, shown } = device(client);
  const range = await load();

  const moving = writes.move(spin, placementFor(range, spin.id, "2030-03-05", 0));
  assert.deepEqual(namesOn(shown(), "2030-03-04"), []);
  await moving;
  assert.deepEqual(namesOn(shown(), "2030-03-04"), ["Spin"]);
  assert.equal(shown().days[1].planned.length, 20);
  const [notice] = writes.notices();
  assert.equal(notice.kind, "refused");
  assert.match(notice.reason, /20 planned items/);
});

test("a move sent late loses to a later move from another browser, and can then win on purpose", async () => {
  const { client } = await athlete();
  const [spin] = await planDay(client, "2030-03-04", ["Spin"]);
  let reconnect;
  const offline = new Promise((resolve) => (reconnect = resolve));
  let firstTry = true;
  const laptop = device(client, {
    move: async (input) => {
      if (firstTry) {
        firstTry = false;
        await offline;
        throw new TypeError("fetch failed");
      }
      return client.plannedWorkouts.move(input);
    },
  });
  const range = await laptop.load();

  const laptopMove = laptop.writes.move(spin, placementFor(range, spin.id, "2030-03-08", 0));
  assert.deepEqual(namesOn(laptop.shown(), "2030-03-08"), ["Spin"]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await client.plannedWorkouts.move({
    id: spin.id,
    day: "2030-03-06",
    position: 0,
    updatedAt: new Date(),
  });
  reconnect();
  await laptopMove;

  assert.deepEqual(namesOn(laptop.shown(), "2030-03-08"), []);
  assert.deepEqual(namesOn(laptop.shown(), "2030-03-06"), ["Spin"]);
  const [notice] = laptop.writes.notices();
  assert.equal(notice.kind, "overruled");
  assert.equal(notice.write, "move");
  assert.equal(notice.item.day, "2030-03-06");
  assert.equal(notice.intended.day, "2030-03-08");

  laptop.writes.dismiss(notice.key);
  notice.retry();
  await laptop.writes.settled();
  assert.deepEqual(namesOn(laptop.shown(), "2030-03-08"), ["Spin"]);
  const stored = await client.plannedWorkouts.get({ id: spin.id });
  assert.equal(stored.day, "2030-03-08");
  assert.deepEqual(laptop.writes.notices(), []);
});

test("a refused move rolls back in every range, also under a skip queued after it", async () => {
  const { client } = await athlete();
  await planDay(
    client,
    "2030-03-11",
    Array.from({ length: 20 }, (_, index) => `Session ${index + 1}`),
  );
  const [spin] = await planDay(client, "2030-03-04", ["Spin"]);
  let release;
  const skipHeld = new Promise((resolve) => (release = resolve));
  const laptop = device(client, {
    skip: async (input) => {
      await skipHeld;
      return client.plannedWorkouts.skip(input);
    },
  });
  await laptop.load();
  const next = rangeKey("2030-03-11", "2030-03-17");
  await laptop.queryClient.fetchQuery({
    queryKey: next,
    queryFn: () => client.calendar.range({ from: "2030-03-11", through: "2030-03-17" }),
  });
  const nextWeek = () => laptop.writes.view(laptop.queryClient.getQueryData(next));

  const moving = laptop.writes.move(spin, { day: "2030-03-11", position: 99 });
  const movedCard = laptop.writes.viewItem(null, spin.id, "2030-03-01");
  assert.equal(movedCard.day, "2030-03-11");
  const skipping = laptop.writes.skip(movedCard, { reason: null });
  await moving;

  assert.deepEqual(namesOn(laptop.shown(), "2030-03-04"), ["Spin"]);
  assert.equal(laptop.shown().days[0].planned[0].state, "skipped");
  assert.equal(nextWeek().days[0].planned.length, 20, "the refused move leaves no copy behind");
  release();
  await skipping;
  assert.equal(laptop.writes.notices()[0].kind, "refused");
});

test("a skip queued behind a lost move follows the item to the day the other browser chose", async () => {
  const { client } = await athlete();
  const [spin] = await planDay(client, "2030-03-04", ["Spin"]);
  let reconnect;
  const offline = new Promise((resolve) => (reconnect = resolve));
  let release;
  const skipHeld = new Promise((resolve) => (release = resolve));
  let firstTry = true;
  const laptop = device(client, {
    move: async (input) => {
      if (firstTry) {
        firstTry = false;
        await offline;
        throw new TypeError("fetch failed");
      }
      return client.plannedWorkouts.move(input);
    },
    skip: async (input) => {
      await skipHeld;
      return client.plannedWorkouts.skip(input);
    },
  });
  const range = await laptop.load();
  const moving = laptop.writes.move(spin, placementFor(range, spin.id, "2030-03-06", 0));
  const skipping = laptop.writes.skip(spin, { reason: "Ill" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await client.plannedWorkouts.move({
    id: spin.id,
    day: "2030-04-10",
    position: 0,
    updatedAt: new Date(),
  });
  reconnect();
  await moving;

  const shown = laptop.shown();
  assert.deepEqual(
    shown.days.flatMap((day) => day.planned.map((item) => item.id)),
    [],
    "the item is in April now, outside the week on screen",
  );
  const item = laptop.writes.viewItem(null, spin.id, shown.today);
  assert.deepEqual([item.day, item.state], ["2030-04-10", "skipped"]);
  release();
  await skipping;
  assert.equal((await client.plannedWorkouts.get({ id: spin.id })).day, "2030-04-10");
});

test("a change queued behind a move out of the range stays with the moved item", async () => {
  const { client } = await athlete();
  const [spin] = await planDay(client, "2030-03-04", ["Spin"]);
  let release;
  const moveHeld = new Promise((resolve) => (release = resolve));
  const laptop = device(client, {
    move: async (input) => {
      await moveHeld;
      return client.plannedWorkouts.move(input);
    },
  });
  await laptop.load();
  const skipping = laptop.writes.skip(spin, { reason: null });
  const moving = laptop.writes.move(spin, { day: "2030-03-11", position: 0 });
  const changing = laptop.writes.change(spin, { ...spin.content, notes: "Easy spin" });
  await skipping;

  assert.deepEqual(
    laptop.shown().days.flatMap((day) => day.planned.map((item) => item.id)),
    [],
    "the item is on its way to the next week, outside the week on screen",
  );
  const item = laptop.writes.viewItem(null, spin.id, "2030-03-01");
  assert.deepEqual(
    [item.day, item.state, item.content.notes],
    ["2030-03-11", "skipped", "Easy spin"],
  );
  release();
  await Promise.all([moving, changing]);
  const stored = await client.plannedWorkouts.get({ id: spin.id });
  assert.deepEqual([stored.day, stored.content.notes], ["2030-03-11", "Easy spin"]);
});

test("skipping a workout another browser deleted takes it off the calendar and says so", async () => {
  const { client } = await athlete();
  const [spin] = await planDay(client, "2030-03-04", ["Spin"]);
  const { writes, load, shown } = device(client);
  await load();
  await client.plannedWorkouts.delete({ id: spin.id });

  await writes.skip(spin, { reason: "Ill" });
  assert.deepEqual(namesOn(shown(), "2030-03-04"), []);
  assert.deepEqual(
    writes.notices().map(({ kind, name }) => [kind, name]),
    [["deleted", "Spin"]],
  );
});

test("a planned workout's skip shows at once, and its reason is kept", async () => {
  const { client } = await athlete();
  const [spin] = await planDay(client, "2030-03-04", ["Spin"]);
  const { writes, load, shown } = device(client);
  await load();
  const skipping = writes.skip(spin, { reason: "Work ran late" });
  assert.equal(shown().days[0].planned[0].state, "skipped");
  await skipping;
  const stored = await client.plannedWorkouts.get({ id: spin.id });
  assert.deepEqual([stored.state, stored.skipped], ["skipped", { reason: "Work ran late" }]);
  await writes.skip(stored, null);
  assert.equal((await client.plannedWorkouts.get({ id: spin.id })).skipped, null);
});

test("a copied week lands after what the target week already holds", async () => {
  const { client } = await athlete();
  await planDay(client, "2030-03-04", ["Openers", "Spin"]);
  await planDay(client, "2030-03-06", ["Threshold"]);
  await planDay(client, "2030-03-13", ["Already there"]);
  const source = await client.calendar.range({ from: "2030-03-04", through: "2030-03-10" });
  const target = await client.calendar.range({ from: "2030-03-11", through: "2030-03-17" });
  const { writes } = device(client);
  const copies = weekCopies(source.days, target.days, randomUUID);
  assert.deepEqual(
    copies.map(({ day, content }) => [day, content.workout.name]),
    [
      ["2030-03-11", "Openers"],
      ["2030-03-11", "Spin"],
      ["2030-03-13", "Threshold"],
    ],
  );
  await Promise.all(copies.map((copy) => writes.plan(copy, source.today)));
  const copied = await client.calendar.range({ from: "2030-03-11", through: "2030-03-17" });
  assert.deepEqual(namesOn(copied, "2030-03-13"), ["Already there", "Threshold"]);
  assert.deepEqual(namesOn(copied, "2030-03-11"), ["Openers", "Spin"]);
  assert.deepEqual(
    weeksOf(copied).map((week) => week.start),
    ["2030-03-11"],
  );
});

test("saving an edited copy warns when another browser changed it, but not when it only moved it", async () => {
  const { client } = await athlete();
  const [spin] = await planDay(client, "2030-03-04", ["Spin"]);
  const edited = { ...spin.content.workout, name: "Spin, longer" };

  await client.plannedWorkouts.move({
    id: spin.id,
    day: "2030-03-05",
    position: 0,
    updatedAt: new Date(),
  });
  const saved = await savePlannedWorkout(client, { base: spin, workout: edited, overwrite: false });
  assert.equal(saved.kind, "saved");
  assert.equal(saved.stored.day, "2030-03-05", "the edit leaves the move alone");

  await client.plannedWorkouts.put({
    ...saved.stored,
    content: ride("Renamed elsewhere"),
    updatedAt: new Date(),
  });
  const conflict = await savePlannedWorkout(client, {
    base: saved.stored,
    workout: { ...edited, name: "Mine" },
    overwrite: false,
  });
  assert.equal(conflict.kind, "changed");
  assert.equal(conflict.stored.content.workout.name, "Renamed elsewhere");
  const overwritten = await savePlannedWorkout(client, {
    base: saved.stored,
    workout: { ...edited, name: "Mine" },
    overwrite: true,
  });
  assert.equal(overwritten.kind, "saved");
  assert.equal((await client.plannedWorkouts.get({ id: spin.id })).content.workout.name, "Mine");
});

test("signing out drops the writes still waiting for the network", async () => {
  const { client } = await athlete();
  const [spin] = await planDay(client, "2030-03-04", ["Spin"]);
  let tries = 0;
  const laptop = device(client, {
    move: async () => {
      tries += 1;
      throw new TypeError("fetch failed");
    },
  });
  await laptop.load();
  const moving = laptop.writes.move(spin, { day: "2030-03-06", position: 0 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  laptop.writes.clear();
  await moving;
  const triedBeforeClear = tries;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(tries, triedBeforeClear, "no retry after sign-out");
  assert.equal(laptop.writes.retrying(), false);
  assert.equal((await client.plannedWorkouts.get({ id: spin.id })).day, "2030-03-04");
});

test("saving an edited copy warns about an older content edit that arrived after a later move", async () => {
  const { client } = await athlete();
  const [spin] = await planDay(client, "2030-03-04", ["Spin"]);
  const offlineEdit = new Date();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const movedLater = await client.plannedWorkouts.move({
    id: spin.id,
    day: "2030-03-05",
    position: 0,
    updatedAt: new Date(),
  });
  await client.plannedWorkouts.put({
    ...movedLater,
    content: ride("Edited offline"),
    updatedAt: offlineEdit,
  });
  const conflict = await savePlannedWorkout(client, {
    base: movedLater,
    workout: { ...spin.content.workout, name: "Mine" },
    overwrite: false,
  });
  assert.equal(conflict.kind, "changed");

  await client.plannedWorkouts.put({
    ...movedLater,
    content: { kind: "rest", notes: null },
    updatedAt: new Date(),
  });
  const replaced = await savePlannedWorkout(client, {
    base: movedLater,
    workout: { ...spin.content.workout, name: "Mine" },
    overwrite: false,
  });
  assert.equal(replaced.kind, "refused");
  assert.match(replaced.reason, /rest day/);
  assert.equal((await client.plannedWorkouts.get({ id: spin.id })).content.kind, "rest");
});
