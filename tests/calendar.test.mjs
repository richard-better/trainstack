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

const watts = (seconds, value) => ({
  type: "step",
  duration: { type: "time", seconds },
  target: { type: "power", unit: "watts", level: { kind: "constant", value } },
});

const steadyRide = (name = "Steady", value = 200) => ({
  name,
  sport: "cycling",
  steps: [watts(3600, value)],
});

const workoutContent = (workout = steadyRide(), source = null) => ({
  kind: "workout",
  workout,
  source,
  notes: null,
});

const ftp = (day, value, minute = 0) => ({
  day,
  change: { kind: "threshold", sport: null, threshold: "ftp", value },
  updatedAt: at(minute),
});

async function definedError(promise, code) {
  const [error] = await safe(promise);
  assert.ok(isDefinedError(error), `expected ${code}, got ${error}`);
  assert.equal(error.code, code);
  return error;
}

async function runCron() {
  const { outcome } = await (await runtime.getWorker()).scheduled({ cron: "* * * * *" });
  assert.equal(outcome, "ok");
}

const todayIn = (timeZone) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
const shifted = (day, days) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

test("an athlete plans a library workout as a copy, with what it asks for on the thresholds of its day", async () => {
  const { client } = await athlete();
  await client.settings.write({ writes: [ftp("2026-01-01", 200), ftp("2026-03-01", 250, 1)] });
  const workoutId = randomUUID();
  const stored = await client.workouts.put({
    id: workoutId,
    workout: steadyRide(),
    updatedAt: at(2),
  });
  const id = randomUUID();
  const planned = await client.plannedWorkouts.put({
    id,
    day: "2026-02-10",
    position: 1,
    content: workoutContent(stored.workout, {
      kind: "library",
      id: workoutId,
      updatedAt: stored.updatedAt,
    }),
    updatedAt: at(3),
  });
  assert.equal(planned.day, "2026-02-10");
  assert.equal(planned.state, "missed");
  assert.deepEqual(planned.planned, { seconds: 3600, meters: null, load: 100 });
  assert.deepEqual(planned.content.source, {
    kind: "library",
    id: workoutId,
    updatedAt: stored.updatedAt,
  });
  assert.deepEqual(planned.updatedAt, at(3));

  await client.workouts.put({
    id: workoutId,
    workout: steadyRide("Edited", 300),
    updatedAt: at(4),
  });
  const kept = await client.plannedWorkouts.get({ id });
  assert.equal(kept.content.workout.name, "Steady");

  const moved = await client.plannedWorkouts.move({
    id,
    day: "2026-04-10",
    position: 1,
    updatedAt: at(5),
  });
  assert.equal(moved.day, "2026-04-10");
  assert.equal(moved.planned.load, 64);

  const changed = await client.plannedWorkouts.put({
    id,
    day: "2026-01-01",
    position: 9,
    content: workoutContent(steadyRide("Harder", 250)),
    updatedAt: at(6),
  });
  assert.equal(changed.day, "2026-04-10", "a put does not move an existing planned workout");
  assert.equal(changed.position, 1);
  assert.equal(changed.planned.load, 100);
  assert.equal(changed.content.source, null);

  const skipped = await client.plannedWorkouts.skip({
    id,
    skipped: { reason: "Sick" },
    updatedAt: at(7),
  });
  assert.equal(skipped.state, "skipped");
  assert.deepEqual(skipped.skipped, { reason: "Sick" });
  const unskipped = await client.plannedWorkouts.skip({ id, skipped: null, updatedAt: at(8) });
  assert.equal(unskipped.skipped, null);
  assert.equal(unskipped.state, "missed");

  const deletion = await client.plannedWorkouts.delete({ id });
  await definedError(client.plannedWorkouts.get({ id }), "PLANNED_WORKOUT_DELETED");
  await definedError(
    client.plannedWorkouts.move({ id, day: "2026-04-11", position: 1, updatedAt: at(9) }),
    "PLANNED_WORKOUT_DELETED",
  );
  const replay = await definedError(
    client.plannedWorkouts.put({
      id,
      day: "2026-04-11",
      position: 1,
      content: workoutContent(),
      updatedAt: at(10),
    }),
    "PLANNED_WORKOUT_DELETED",
  );
  assert.deepEqual(replay.data, deletion);
  await definedError(
    client.plannedWorkouts.skip({ id, skipped: null, updatedAt: at(11) }),
    "PLANNED_WORKOUT_DELETED",
  );
  assert.deepEqual(await client.plannedWorkouts.delete({ id }), deletion);
});

test("a built-in workout, a note and a rest day go on the calendar too, and only workouts can be missed", async () => {
  const { client } = await athlete();
  const builtin = (await client.builtinWorkouts.list({ limit: 1 })).workouts[0];
  const full = await client.builtinWorkouts.get({ id: builtin.id });
  const day = "2026-02-02";
  const workout = await client.plannedWorkouts.put({
    id: randomUUID(),
    day,
    position: 1,
    content: workoutContent(full.workout, { kind: "builtin", id: builtin.id }),
    updatedAt: at(0),
  });
  assert.equal(workout.state, "missed");
  assert.equal(workout.planned.seconds, builtin.totals.seconds);
  const note = await client.plannedWorkouts.put({
    id: randomUUID(),
    day,
    position: 2,
    content: { kind: "note", title: "Race recon", notes: "Drive the course" },
    updatedAt: at(0),
  });
  assert.equal(note.planned, null);
  assert.equal(note.state, "planned");
  const rest = await client.plannedWorkouts.put({
    id: randomUUID(),
    day,
    position: 0,
    content: { kind: "rest", notes: null },
    updatedAt: at(0),
  });
  assert.equal(rest.state, "planned");
  const { days } = await client.calendar.range({ from: day, through: day });
  assert.deepEqual(
    days[0].planned.map(({ id }) => id),
    [rest.id, workout.id, note.id],
  );
  assert.equal(days[0].totals.planned.seconds, builtin.totals.seconds);
});

test("a day holds a bounded number of planned workouts, in order", async () => {
  const { client } = await athlete();
  const day = "2027-05-05";
  for (let position = 0; position < 20; position++) {
    await client.plannedWorkouts.put({
      id: randomUUID(),
      day,
      position: 20 - position,
      content: { kind: "note", title: `Note ${position}`, notes: null },
      updatedAt: at(0),
    });
  }
  await definedError(
    client.plannedWorkouts.put({
      id: randomUUID(),
      day,
      position: 0,
      content: { kind: "rest", notes: null },
      updatedAt: at(0),
    }),
    "DAY_FULL",
  );
  const elsewhere = await client.plannedWorkouts.put({
    id: randomUUID(),
    day: "2027-05-06",
    position: 0,
    content: { kind: "rest", notes: null },
    updatedAt: at(0),
  });
  await definedError(
    client.plannedWorkouts.move({ id: elsewhere.id, day, position: 1, updatedAt: at(1) }),
    "DAY_FULL",
  );
  const { days } = await client.calendar.range({ from: day, through: day });
  const positions = days[0].planned.map(({ position }) => position);
  assert.deepEqual(
    positions,
    positions.toSorted((a, b) => a - b),
  );
});

test("simultaneous plans and moves onto a nearly full day never overfill it", async () => {
  const { client } = await athlete();
  const day = "2027-05-10";
  const note = (title) => ({ kind: "note", title, notes: null });
  for (let position = 0; position < 19; position++) {
    await client.plannedWorkouts.put({
      id: randomUUID(),
      day,
      position,
      content: note(`Note ${position}`),
      updatedAt: at(0),
    });
  }
  const others = [];
  for (const index of [0, 1]) {
    others.push(
      await client.plannedWorkouts.put({
        id: randomUUID(),
        day: "2027-05-11",
        position: index,
        content: note(`Other ${index}`),
        updatedAt: at(0),
      }),
    );
  }
  const results = await Promise.all([
    safe(
      client.plannedWorkouts.put({
        id: randomUUID(),
        day,
        position: 30,
        content: note("A"),
        updatedAt: at(1),
      }),
    ),
    safe(
      client.plannedWorkouts.put({
        id: randomUUID(),
        day,
        position: 31,
        content: note("B"),
        updatedAt: at(1),
      }),
    ),
    ...others.map(({ id }) =>
      safe(client.plannedWorkouts.move({ id, day, position: 40, updatedAt: at(2) })),
    ),
  ]);
  assert.equal(results.filter(([error]) => error === null).length, 1);
  for (const [error] of results.filter(([error]) => error !== null)) {
    assert.equal(error.code, "DAY_FULL");
  }
  const { days } = await client.calendar.range({ from: day, through: day });
  assert.equal(days[0].planned.length, 20);
});

test("a change and a move at the same moment leave numbers that match what and where the workout is", async () => {
  const { client } = await athlete();
  await client.settings.write({ writes: [ftp("2026-01-01", 200), ftp("2026-03-01", 250, 1)] });
  const expected = {
    "200 2026-02-10": 100,
    "200 2026-04-10": 64,
    "250 2026-02-10": 156,
    "250 2026-04-10": 100,
  };
  for (let round = 0; round < 6; round++) {
    const id = randomUUID();
    await client.plannedWorkouts.put({
      id,
      day: "2026-02-10",
      position: 1,
      content: workoutContent(steadyRide("Ride", 200)),
      updatedAt: at(2),
    });
    await Promise.all([
      client.plannedWorkouts.put({
        id,
        day: "2026-02-10",
        position: 1,
        content: workoutContent(steadyRide("Ride", 250)),
        updatedAt: at(3),
      }),
      client.plannedWorkouts.move({ id, day: "2026-04-10", position: 1, updatedAt: at(3) }),
    ]);
    const result = await client.plannedWorkouts.get({ id });
    const watts = result.content.workout.steps[0].target.level.value;
    assert.equal(watts, 250);
    assert.equal(result.day, "2026-04-10");
    assert.equal(result.planned.load, expected[`${watts} ${result.day}`]);
    const [changed] = (await client.calendar.range({ from: result.day, through: result.day }))
      .days[0].planned;
    assert.equal(changed.planned.load, result.planned.load);
  }
});

test("the calendar gives each day and each whole week across a year's end, with only the primary of a workout recorded twice", async () => {
  const { client } = await athlete();
  await client.settings.write({ writes: [ftp("2026-01-01", 200)] });
  await client.settings.setTimeZone({ timeZone: "Pacific/Kiritimati" });
  const ride = await client.activities.upload({
    file: new File([denseRide(60_000, "2026-12-31T12:00:00Z")], "ride.fit"),
    source: "upload",
  });
  await client.activities.upload({
    file: new File([denseRide(62_000, "2026-12-31T12:00:00Z")], "ride.fit"),
    source: "strava",
  });
  for (let run = 0; run < 3; run++) await runCron();
  const primary = (await client.activities.get({ id: ride.id })).primary
    ? ride.id
    : (await client.activities.get({ id: ride.id })).duplicates[0].id;
  const done = await client.activities.get({ id: primary });
  assert.equal(done.localDay, "2027-01-01");

  const plan = (day, value) =>
    client.plannedWorkouts.put({
      id: randomUUID(),
      day,
      position: 1,
      content: workoutContent(steadyRide("Ride", value)),
      updatedAt: at(0),
    });
  await plan("2026-12-28", 200);
  await plan("2026-12-31", 100);
  await plan("2027-01-01", 200);
  await plan("2027-01-04", 200);

  const calendar = await client.calendar.range({ from: "2026-12-30", through: "2027-01-02" });
  assert.equal(calendar.today, todayIn("Pacific/Kiritimati"));
  assert.deepEqual(
    calendar.days.map(({ day }) => day),
    ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"],
  );
  const newYear = calendar.days[2];
  assert.deepEqual(
    newYear.activities.map(({ id }) => id),
    [primary],
  );
  const [activity] = newYear.activities;
  assert.equal(activity.seconds, done.statistics.timer_s ?? done.statistics.elapsed_s);
  assert.equal(activity.load, done.statistics.load_tss);
  assert.ok(activity.load > 0);
  assert.deepEqual(newYear.totals, {
    planned: { seconds: 3600, meters: 0, load: 100 },
    completed: { seconds: activity.seconds, meters: activity.meters ?? 0, load: activity.load },
  });
  assert.deepEqual(calendar.days[1].totals.planned, { seconds: 3600, meters: 0, load: 25 });
  assert.deepEqual(calendar.weeks, [
    {
      start: "2026-12-28",
      totals: {
        planned: { seconds: 3 * 3600, meters: 0, load: 225 },
        completed: newYear.totals.completed,
      },
    },
  ]);

  const month = await client.calendar.range({ from: "2026-12-28", through: "2027-02-07" });
  assert.equal(month.days.length, 42);
  assert.deepEqual(
    month.weeks.map(({ start }) => start),
    ["2026-12-28", "2027-01-04", "2027-01-11", "2027-01-18", "2027-01-25", "2027-02-01"],
  );
  assert.equal(month.weeks[1].totals.planned.load, 100);

  await assert.rejects(client.calendar.range({ from: "2027-01-02", through: "2027-01-01" }), {
    code: "BAD_REQUEST",
  });
  await assert.rejects(client.calendar.range({ from: "2027-01-01", through: "2027-04-03" }), {
    code: "BAD_REQUEST",
  });
});

test("whether a workout is missed follows today in the athlete's time zone", async () => {
  const { client } = await athlete();
  await client.settings.setTimeZone({ timeZone: "Pacific/Pago_Pago" });
  const day = todayIn("Pacific/Pago_Pago");
  const { id } = await client.plannedWorkouts.put({
    id: randomUUID(),
    day,
    position: 1,
    content: workoutContent(),
    updatedAt: at(0),
  });
  const yesterday = await client.plannedWorkouts.put({
    id: randomUUID(),
    day: shifted(day, -1),
    position: 1,
    content: workoutContent(),
    updatedAt: at(0),
  });
  assert.equal((await client.plannedWorkouts.get({ id })).state, "planned");
  assert.equal(yesterday.state, "missed");
  await client.settings.setTimeZone({ timeZone: "Pacific/Kiritimati" });
  assert.equal((await client.plannedWorkouts.get({ id })).state, "missed");
});

test("two devices editing different parts offline both keep their edit, in either order", async () => {
  for (const order of [
    ["move", "change"],
    ["change", "move"],
  ]) {
    const { client } = await athlete();
    const id = randomUUID();
    await client.plannedWorkouts.put({
      id,
      day: "2027-03-01",
      position: 1,
      content: workoutContent(),
      updatedAt: at(0),
    });
    const edits = {
      move: () =>
        client.plannedWorkouts.move({ id, day: "2027-03-02", position: 2, updatedAt: at(2) }),
      change: () =>
        client.plannedWorkouts.put({
          id,
          day: "2027-03-01",
          position: 1,
          content: workoutContent(steadyRide("Changed")),
          updatedAt: at(1),
        }),
    };
    for (const edit of order) await edits[edit]();
    await client.plannedWorkouts.skip({ id, skipped: { reason: null }, updatedAt: at(3) });
    const result = await client.plannedWorkouts.get({ id });
    assert.equal(result.day, "2027-03-02", order.join(" then "));
    assert.equal(result.content.workout.name, "Changed", order.join(" then "));
    assert.deepEqual(result.skipped, { reason: null });
    assert.deepEqual(result.updatedAt, at(3));
  }
});

test("of two edits to the same part, the later one wins whichever arrives last, and a tie settles the same way", async () => {
  const { client } = await athlete();
  const plannedOn = async (day) =>
    (
      await client.plannedWorkouts.put({
        id: randomUUID(),
        day,
        position: 1,
        content: workoutContent(),
        updatedAt: at(0),
      })
    ).id;

  const late = await plannedOn("2027-03-10");
  await client.plannedWorkouts.move({ id: late, day: "2027-03-12", position: 1, updatedAt: at(5) });
  const stale = await client.plannedWorkouts.move({
    id: late,
    day: "2027-03-11",
    position: 1,
    updatedAt: at(4),
  });
  assert.equal(stale.day, "2027-03-12");

  const skip = await plannedOn("2027-03-10");
  await client.plannedWorkouts.skip({ id: skip, skipped: { reason: "Travel" }, updatedAt: at(5) });
  const staleUnskip = await client.plannedWorkouts.skip({
    id: skip,
    skipped: null,
    updatedAt: at(4),
  });
  assert.deepEqual(staleUnskip.skipped, { reason: "Travel" });

  const content = await plannedOn("2027-03-10");
  await client.plannedWorkouts.put({
    id: content,
    day: "2027-03-10",
    position: 1,
    content: workoutContent(steadyRide("Newer")),
    updatedAt: at(5),
  });
  const staleContent = await client.plannedWorkouts.put({
    id: content,
    day: "2027-03-10",
    position: 1,
    content: workoutContent(steadyRide("Older")),
    updatedAt: at(4),
  });
  assert.equal(staleContent.content.workout.name, "Newer");

  const unicode = await plannedOn("2027-03-10");
  const titled = (title) =>
    client.plannedWorkouts.put({
      id: unicode,
      day: "2027-03-10",
      position: 1,
      content: { kind: "note", title, notes: null },
      updatedAt: at(7),
    });
  await titled("😀");
  assert.equal((await titled("Ａ")).content.title, (await titled("😀")).content.title);

  const tied = [];
  for (const days of [
    ["2027-03-20", "2027-03-21"],
    ["2027-03-21", "2027-03-20"],
  ]) {
    const id = await plannedOn("2027-03-10");
    for (const day of days) {
      await client.plannedWorkouts.move({ id, day, position: 1, updatedAt: at(6) });
    }
    tied.push((await client.plannedWorkouts.get({ id })).day);
  }
  assert.equal(tied[0], tied[1]);

  const deletedFirst = await plannedOn("2027-03-10");
  await client.plannedWorkouts.delete({ id: deletedFirst });
  await definedError(
    client.plannedWorkouts.move({
      id: deletedFirst,
      day: "2027-03-11",
      position: 1,
      updatedAt: new Date(Date.now()),
    }),
    "PLANNED_WORKOUT_DELETED",
  );

  await definedError(
    client.plannedWorkouts.move({
      id: content,
      day: "2027-03-11",
      position: 1,
      updatedAt: new Date(Date.now() + 60 * 60 * 1000),
    }),
    "EDITED_IN_THE_FUTURE",
  );
  await definedError(
    client.plannedWorkouts.move({
      id: randomUUID(),
      day: "2027-03-11",
      position: 1,
      updatedAt: at(1),
    }),
    "NOT_FOUND",
  );
});

test("a device follows the calendar's changes from a cursor, deletions included", async () => {
  const { client } = await athlete();
  const first = await client.plannedWorkouts.put({
    id: randomUUID(),
    day: "2027-06-01",
    position: 1,
    content: workoutContent(),
    updatedAt: at(0),
  });
  const all = await client.plannedWorkouts.changes({});
  assert.deepEqual(
    all.planned.map(({ id }) => id),
    [first.id],
  );
  const second = await client.plannedWorkouts.put({
    id: randomUUID(),
    day: "2027-06-02",
    position: 1,
    content: { kind: "rest", notes: null },
    updatedAt: at(0),
  });
  await client.plannedWorkouts.move({
    id: first.id,
    day: "2027-06-03",
    position: 1,
    updatedAt: at(1),
  });
  await client.plannedWorkouts.delete({ id: second.id });
  const since = await client.plannedWorkouts.changes({ since: all.cursor });
  assert.deepEqual(
    since.planned.map(({ id, day }) => [id, day]),
    [[first.id, "2027-06-03"]],
  );
  assert.deepEqual(
    since.deleted.map(({ id }) => id),
    [second.id],
  );
  assert.deepEqual(await client.plannedWorkouts.changes({ since: since.cursor }), {
    planned: [],
    deleted: [],
    cursor: since.cursor,
  });
});

test("the calendar reads an athlete's days through indexes", async () => {
  const plan = await db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT * FROM planned_workout WHERE user_id = ? AND day BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY day, position, id",
    )
    .bind("someone", "2027-01-01", "2027-01-31")
    .all();
  const detail = plan.results.map((row) => row.detail).join("\n");
  assert.match(detail, /USING INDEX planned_workout_user_day_idx/);
  assert.doesNotMatch(detail, /TEMP B-TREE/);
});
