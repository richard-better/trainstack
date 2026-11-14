import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isDefinedError, safe } from "@orpc/client";
import { mockApple } from "./helpers/apple.mjs";
import { denseRide } from "./helpers/fit-files.mjs";
import { migrate, rpcClient, startWorker } from "./helpers/worker.mjs";

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

async function athlete() {
  const signedIn = await apple.signIn(runtime, { email: `${randomUUID()}@example.com` });
  return { ...signedIn, client: rpcClient(runtime, { token: signedIn.token }) };
}

const at = (minute) => new Date(Date.UTC(2026, 10, 13, 9, minute));

async function runCron() {
  const { outcome } = await (await runtime.getWorker()).scheduled({ cron: "* * * * *" });
  assert.equal(outcome, "ok");
}

const minutesOfRide = (minutes) => Math.round(minutes * 60 * 25 + 200);

const ride = (day, minutes, hour = 6) =>
  new File([denseRide(minutesOfRide(minutes), `${day}T0${hour}:00:00Z`)], "ride.fit");

const workout = (sport, minutes) => ({
  kind: "workout",
  workout: {
    name: `${minutes} min ${sport}`,
    sport,
    steps: [{ type: "step", duration: { type: "time", seconds: minutes * 60 } }],
  },
  source: null,
  notes: null,
});

function planner(client) {
  let position = 0;
  return async (day, content) =>
    (
      await client.plannedWorkouts.put({
        id: randomUUID(),
        day,
        position: position++,
        content,
        updatedAt: at(0),
      })
    ).id;
}

async function dayOf(client, day) {
  const { days } = await client.calendar.range({ from: day, through: day });
  return days[0];
}

const pairsOf = (calendarDay) =>
  Object.fromEntries(
    calendarDay.planned.map((planned) => [
      planned.id,
      planned.pairing && [planned.pairing.activityId, planned.pairing.by],
    ]),
  );

async function definedError(promise, code) {
  const [error] = await safe(promise);
  assert.ok(isDefinedError(error), `expected ${code}, got ${error}`);
  assert.equal(error.code, code);
}

test("a planned workout pairs with the activity done that day, whichever arrives first", async () => {
  const { client } = await athlete();
  const plan = planner(client);
  const day = "2026-06-01";
  const first = await plan(day, workout("cycling", 40));
  assert.equal((await client.plannedWorkouts.get({ id: first })).state, "missed");
  const done = await client.activities.upload({
    file: ride(day, 40),
    source: "upload",
    sport: "cycling",
  });
  const calendarDay = await dayOf(client, day);
  assert.deepEqual(pairsOf(calendarDay), { [first]: [done.id, "auto"] });
  assert.equal(calendarDay.planned[0].state, "completed");
  assert.equal(calendarDay.activities[0].plannedId, first);

  const later = "2026-06-03";
  const alreadyDone = await client.activities.upload({
    file: ride(later, 30),
    source: "upload",
    sport: "cycling",
  });
  const planned = await plan(later, workout("cycling", 30));
  assert.deepEqual(await client.plannedWorkouts.get({ id: planned }).then((p) => p.pairing), {
    activityId: alreadyDone.id,
    by: "auto",
  });
});

test("two sessions on a day pair by closeness of time, and only within a sport", async () => {
  const { client } = await athlete();
  const plan = planner(client);
  const day = "2026-06-05";
  const long = await plan(day, workout("cycling", 80));
  const short = await plan(day, workout("cycling", 40));
  const run = await plan(day, workout("running", 40));
  const morning = await client.activities.upload({
    file: ride(day, 40, 6),
    source: "upload",
    sport: "cycling",
  });
  const evening = await client.activities.upload({
    file: ride(day, 80, 8),
    source: "upload",
    sport: "cycling",
  });
  assert.deepEqual(pairsOf(await dayOf(client, day)), {
    [long]: [evening.id, "auto"],
    [short]: [morning.id, "auto"],
    [run]: null,
  });
  assert.equal((await client.plannedWorkouts.get({ id: run })).state, "missed");
});

test("the athlete's pairings hold over the rule, and a pair taken apart stays apart", async () => {
  const { client } = await athlete();
  const plan = planner(client);
  const day = "2026-06-08";
  const long = await plan(day, workout("cycling", 80));
  const short = await plan(day, workout("cycling", 40));
  const morning = await client.activities.upload({
    file: ride(day, 40, 6),
    source: "upload",
    sport: "cycling",
  });
  const evening = await client.activities.upload({
    file: ride(day, 80, 8),
    source: "upload",
    sport: "cycling",
  });

  const crossed = await client.plannedWorkouts.pair({
    id: short,
    activityId: evening.id,
    updatedAt: at(1),
  });
  assert.deepEqual(crossed.pairing, { activityId: evening.id, by: "athlete" });
  assert.deepEqual(pairsOf(await dayOf(client, day)), {
    [long]: [morning.id, "auto"],
    [short]: [evening.id, "athlete"],
  });

  await client.plannedWorkouts.unpair({ id: long, activityId: morning.id, updatedAt: at(2) });
  const apart = await dayOf(client, day);
  assert.deepEqual(pairsOf(apart), { [long]: null, [short]: [evening.id, "athlete"] });
  assert.equal(apart.activities.find(({ id }) => id === morning.id).plannedId, null);

  await client.plannedWorkouts.pair({ id: long, activityId: morning.id, updatedAt: at(1) });
  assert.equal(pairsOf(await dayOf(client, day))[long], null, "an older pairing loses");
  await client.plannedWorkouts.pair({ id: long, activityId: morning.id, updatedAt: at(3) });
  assert.deepEqual(pairsOf(await dayOf(client, day))[long], [morning.id, "athlete"]);

  await client.plannedWorkouts.pair({ id: long, activityId: evening.id, updatedAt: at(4) });
  assert.deepEqual(pairsOf(await dayOf(client, day)), {
    [long]: [evening.id, "athlete"],
    [short]: [morning.id, "auto"],
  });
});

test("moving a planned workout off the day lets go of its activity, and moving it back brings the choice back", async () => {
  const { client } = await athlete();
  const plan = planner(client);
  const day = "2026-06-10";
  const planned = await plan(day, workout("running", 40));
  const done = await client.activities.upload({
    file: ride(day, 40),
    source: "upload",
    sport: "cycling",
  });
  assert.equal((await dayOf(client, day)).activities[0].plannedId, null, "a ride is not a run");
  await client.plannedWorkouts.pair({ id: planned, activityId: done.id, updatedAt: at(1) });
  assert.equal((await dayOf(client, day)).activities[0].plannedId, planned);

  const moved = await client.plannedWorkouts.move({
    id: planned,
    day: "2026-06-11",
    position: 0,
    updatedAt: at(2),
  });
  assert.equal(moved.pairing, null);
  assert.equal((await dayOf(client, day)).activities[0].plannedId, null);
  const back = await client.plannedWorkouts.move({
    id: planned,
    day,
    position: 0,
    updatedAt: at(3),
  });
  assert.deepEqual(back.pairing, { activityId: done.id, by: "athlete" });
});

test("a workout recorded twice pairs once, by its primary, whichever copy the athlete names", async () => {
  const { client } = await athlete();
  const plan = planner(client);
  const day = "2026-06-12";
  const planned = await plan(day, workout("cycling", 40));
  const first = await client.activities.upload({
    file: ride(day, 40),
    source: "upload",
    sport: "cycling",
  });
  const copy = await client.activities.upload({
    file: new File([denseRide(minutesOfRide(40) + 2000, `${day}T06:00:00Z`)], "ride.fit"),
    source: "strava",
    sport: "cycling",
  });
  for (let run = 0; run < 3; run++) await runCron();
  const primary = (await client.activities.get({ id: first.id })).primary ? first.id : copy.id;
  const other = primary === first.id ? copy.id : first.id;
  const calendarDay = await dayOf(client, day);
  assert.deepEqual(
    calendarDay.activities.map(({ id }) => id),
    [primary],
  );
  await client.plannedWorkouts.unpair({ id: planned, activityId: other, updatedAt: at(1) });
  assert.deepEqual(pairsOf(await dayOf(client, day)), { [planned]: null });
  await client.plannedWorkouts.pair({ id: planned, activityId: other, updatedAt: at(2) });
  assert.deepEqual(pairsOf(await dayOf(client, day)), { [planned]: [primary, "athlete"] });

  await client.plannedWorkouts.unpair({ id: planned, activityId: primary, updatedAt: at(4) });
  await client.plannedWorkouts.pair({ id: planned, activityId: other, updatedAt: at(3) });
  assert.deepEqual(
    pairsOf(await dayOf(client, day)),
    { [planned]: null },
    "the latest choice wins across the copies, whichever arrives last",
  );
  await client.plannedWorkouts.pair({ id: planned, activityId: other, updatedAt: at(5) });
  assert.deepEqual(pairsOf(await dayOf(client, day)), { [planned]: [primary, "athlete"] });

  await db.prepare("UPDATE activity SET local_day = '2026-06-13' WHERE id = ?").bind(other).run();
  const throughCopyOnAnotherDay = await client.plannedWorkouts.pair({
    id: planned,
    activityId: other,
    updatedAt: at(6),
  });
  assert.deepEqual(throughCopyOnAnotherDay.pairing, { activityId: primary, by: "athlete" });
});

test("a skipped workout, a note or a rest day pairs only by the athlete's hand, and only on its day", async () => {
  const { client } = await athlete();
  const plan = planner(client);
  const day = "2026-06-15";
  const skipped = await plan(day, workout("cycling", 40));
  await client.plannedWorkouts.skip({
    id: skipped,
    skipped: { reason: "Tired" },
    updatedAt: at(1),
  });
  const note = await plan(day, { kind: "note", title: "Bike fit", notes: null });
  const done = await client.activities.upload({
    file: ride(day, 40),
    source: "upload",
    sport: "cycling",
  });
  assert.deepEqual(pairsOf(await dayOf(client, day)), { [skipped]: null, [note]: null });
  assert.equal((await client.plannedWorkouts.get({ id: skipped })).state, "skipped");

  const paired = await client.plannedWorkouts.pair({
    id: skipped,
    activityId: done.id,
    updatedAt: at(2),
  });
  assert.equal(paired.state, "completed");
  assert.deepEqual(paired.skipped, { reason: "Tired" });

  await definedError(
    client.plannedWorkouts.pair({ id: note, activityId: done.id, updatedAt: at(3) }),
    "NOT_PAIRABLE",
  );
  const elsewhere = await plan("2026-06-16", workout("cycling", 40));
  await definedError(
    client.plannedWorkouts.pair({ id: elsewhere, activityId: done.id, updatedAt: at(3) }),
    "NOT_PAIRABLE",
  );
  await definedError(
    client.plannedWorkouts.pair({ id: elsewhere, activityId: "0".repeat(64), updatedAt: at(3) }),
    "ACTIVITY_NOT_FOUND",
  );
  await definedError(
    client.plannedWorkouts.pair({ id: randomUUID(), activityId: done.id, updatedAt: at(3) }),
    "NOT_FOUND",
  );
  await definedError(
    client.plannedWorkouts.pair({
      id: skipped,
      activityId: done.id,
      updatedAt: new Date(Date.now() + 60 * 60 * 1000),
    }),
    "EDITED_IN_THE_FUTURE",
  );
});

test("deleting either side ends the pairing, and a deleted planned workout's choices go with it", async () => {
  const { client } = await athlete();
  const plan = planner(client);
  const day = "2026-06-18";
  const planned = await plan(day, workout("cycling", 40));
  const done = await client.activities.upload({
    file: ride(day, 40),
    source: "upload",
    sport: "cycling",
  });
  await client.plannedWorkouts.pair({ id: planned, activityId: done.id, updatedAt: at(1) });
  await client.activities.delete({ id: done.id });
  const after = await client.plannedWorkouts.get({ id: planned });
  assert.equal(after.pairing, null);
  assert.equal(after.state, "missed");

  const again = await client.activities.upload({
    file: ride(day, 41),
    source: "upload",
    sport: "cycling",
  });
  await client.plannedWorkouts.unpair({ id: planned, activityId: again.id, updatedAt: at(2) });
  await client.plannedWorkouts.delete({ id: planned });
  const replanned = await plan(day, workout("cycling", 40));
  assert.deepEqual(pairsOf(await dayOf(client, day)), { [replanned]: [again.id, "auto"] });
});

test("a device following the changes hears of a pairing the athlete made or undid elsewhere, and of the workout it displaced", async () => {
  const { client } = await athlete();
  const plan = planner(client);
  const day = "2026-06-22";
  const long = await plan(day, workout("cycling", 80));
  const short = await plan(day, workout("cycling", 40));
  const morning = await client.activities.upload({
    file: ride(day, 40, 6),
    source: "upload",
    sport: "cycling",
  });
  await client.activities.upload({ file: ride(day, 80, 8), source: "upload", sport: "cycling" });
  const { cursor } = await client.plannedWorkouts.changes({});
  await client.plannedWorkouts.pair({ id: long, activityId: morning.id, updatedAt: at(1) });
  const afterPair = await client.plannedWorkouts.changes({ since: cursor });
  assert.deepEqual(
    Object.fromEntries(afterPair.planned.map(({ id, pairing }) => [id, pairing?.by])),
    { [long]: "athlete", [short]: "auto" },
  );
  await client.plannedWorkouts.unpair({ id: long, activityId: morning.id, updatedAt: at(2) });
  const afterUnpair = await client.plannedWorkouts.changes({ since: afterPair.cursor });
  assert.equal(afterUnpair.planned.find(({ id }) => id === long).pairing.by, "auto");
});

test("the changes feed carries each planned workout's pairing as of the read", async () => {
  const { client } = await athlete();
  const plan = planner(client);
  const day = "2026-06-20";
  const planned = await plan(day, workout("cycling", 40));
  const done = await client.activities.upload({
    file: ride(day, 40),
    source: "upload",
    sport: "cycling",
  });
  const { planned: changed } = await client.plannedWorkouts.changes({});
  assert.deepEqual(
    changed.map(({ id, pairing }) => [id, pairing]),
    [[planned, { activityId: done.id, by: "auto" }]],
  );
});
