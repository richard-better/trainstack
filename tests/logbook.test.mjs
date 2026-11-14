import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isDefinedError, safe } from "@orpc/client";
import { migrate, rpcClient, startWorker } from "./helpers/worker.mjs";
import { mockApple } from "./helpers/apple.mjs";
import { recordedSession } from "./helpers/fit-files.mjs";

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
  const signedIn = await apple.signIn(runtime, { email: `${crypto.randomUUID()}@example.com` });
  return rpcClient(runtime, { token: signedIn.token });
}

const set = (overrides = {}) => ({
  kind: "working",
  reps: 5,
  seconds: null,
  load: { kind: "weight", weight: { value: 100, unit: "kg" } },
  rpe: null,
  repsInReserve: null,
  tempo: null,
  restSeconds: null,
  ...overrides,
});

const kg = (value) => ({ kind: "weight", weight: { value, unit: "kg" } });

const strength = (exercises, overrides = {}) => ({
  startedAt: new Date("2026-11-10T17:00:00Z"),
  durationSeconds: 75 * 60,
  name: null,
  notes: null,
  rpe: 7,
  detail: { sport: "strength", exercises },
  ...overrides,
});

const squats = (weight = 100) => ({
  exerciseId: "back_squat",
  group: null,
  notes: null,
  sets: [
    set({ kind: "warm_up", load: kg(60) }),
    set({ load: kg(weight) }),
    set({ load: kg(weight) }),
  ],
});

const problem = (overrides = {}) => ({
  grade: { scale: "font", grade: "6A" },
  name: null,
  attempts: 1,
  outcome: "flash",
  styles: [],
  angle: null,
  notes: null,
  restSeconds: null,
  ...overrides,
});

const bouldering = (problems, overrides = {}) => ({
  startedAt: new Date("2026-11-11T18:00:00Z"),
  durationSeconds: 90 * 60,
  name: "Evening at the wall",
  notes: null,
  rpe: 6,
  detail: {
    sport: "bouldering",
    venue: { kind: "gym", name: "Boulderbar" },
    circuit: {
      name: "Boulderbar",
      colours: [
        { name: "Yellow", from: "4", to: "5" },
        { name: "Blue", from: "6A", to: "6B" },
      ],
    },
    problems,
  },
  ...overrides,
});

const at = (iso) => new Date(iso);

const fit = (session) => new File([recordedSession(session)], "watch.fit");

async function errorOf(promise) {
  const [error] = await safe(promise);
  assert.ok(isDefinedError(error), `expected a defined error, got ${error}`);
  return error;
}

test("a logged strength session is an activity with no file, in the list, the calendar and the training load", async () => {
  const client = await athlete();
  await client.settings.setTimeZone({ timeZone: "Europe/Budapest" });
  const id = crypto.randomUUID();
  const stored = await client.logbook.put({
    id,
    session: strength([squats()]),
    editedAt: at("2026-11-10T19:00:00Z"),
  });
  assert.equal(stored.localDay, "2026-11-10");
  assert.deepEqual(stored.load, { sessionRpeLoad: 525, stressScore: 100 });
  assert.deepEqual(stored.summary, {
    sport: "strength",
    exercises: 1,
    sets: 2,
    reps: 10,
    volumeKg: 1000,
    unit: "kg",
  });

  const { activities } = await client.activities.list({ onePerWorkout: true });
  assert.equal(activities.length, 1);
  const [listed] = activities;
  assert.equal(listed.id, stored.activityId);
  assert.equal(listed.source, "logbook");
  assert.equal(listed.sourceId, id);
  assert.equal(listed.sport, "strength");
  assert.equal(listed.file, null);
  assert.equal(listed.analysisDue, false);
  assert.equal(listed.localDay, "2026-11-10");
  assert.deepEqual(listed.logged, { sessionId: id, summary: stored.summary });
  assert.deepEqual(listed.statistics, {
    elapsed_s: 4500,
    session_rpe_load_au: 525,
    rpe_stress_tss: 100,
    load_tss: 100,
  });

  const detail = await client.activities.get({ id: stored.activityId });
  assert.deepEqual(detail.events, []);
  assert.equal(detail.logged.sessionId, id);
  const file = await errorOf(client.activities.file({ id: stored.activityId }));
  assert.equal(file.code, "NOT_FOUND");

  const load = await client.training.load({ from: "2026-11-10", through: "2026-11-10" });
  assert.deepEqual(load.days[0].activities, [
    { id: stored.activityId, stress: 100, source: "rpe" },
  ]);
  assert.equal(load.days[0].stress, 100);

  const calendar = await client.calendar.range({ from: "2026-11-10", through: "2026-11-10" });
  const [day] = calendar.days;
  assert.equal(day.activities.length, 1);
  assert.equal(day.activities[0].sport, "strength");
  assert.equal(day.activities[0].seconds, 4500);
  assert.equal(day.activities[0].load, 100);
});

test("a session without an RPE counts no load", async () => {
  const client = await athlete();
  const stored = await client.logbook.put({
    id: crypto.randomUUID(),
    session: strength([squats()], { rpe: null }),
    editedAt: at("2026-11-10T19:00:00Z"),
  });
  assert.equal(stored.load, null);
  const { activities } = await client.activities.list({});
  assert.deepEqual(activities[0].statistics, { elapsed_s: 4500 });
});

test("bodyweight sets count the weight the athlete set for the day, and a heavier session sets records", async () => {
  const client = await athlete();
  await client.settings.write({
    writes: [
      {
        day: "2026-01-01",
        change: { kind: "weight", kg: 70 },
        updatedAt: at("2026-11-01T00:00:00Z"),
      },
    ],
  });
  const pullUps = {
    exerciseId: "pull_up",
    group: null,
    notes: null,
    sets: [set({ reps: 8, load: { kind: "bodyweight" } })],
  };
  const first = await client.logbook.put({
    id: crypto.randomUUID(),
    session: strength([squats(100), pullUps], { startedAt: at("2026-11-03T17:00:00Z") }),
    editedAt: at("2026-11-03T19:00:00Z"),
  });
  assert.equal(first.bodyMassKg, 70);
  assert.equal(first.numbers.exercises[1].volumeKg, 560);
  assert.deepEqual(first.numbers.records, []);

  const second = await client.logbook.put({
    id: crypto.randomUUID(),
    session: strength([squats(110)]),
    editedAt: at("2026-11-10T19:00:00Z"),
  });
  assert.deepEqual(
    second.numbers.records.map(({ kind, value, previous }) => ({ kind, value, previous })),
    [
      { kind: "estimated_one_rep_max", value: 110 * (1 + 5 / 30), previous: 100 * (1 + 5 / 30) },
      { kind: "heaviest", value: 110, previous: 100 },
      { kind: "volume", value: 1100, previous: 1000 },
    ],
  );

  const progress = await client.logbook.strengthProgress({
    exerciseId: "back_squat",
    from: "2026-11-01",
    through: "2026-11-30",
  });
  assert.deepEqual(
    progress.points.map(({ day, numbers }) => [day, numbers.heaviestKg, numbers.volumeKg]),
    [
      ["2026-11-03", 100, 1000],
      ["2026-11-10", 110, 1100],
    ],
  );
  assert.equal(progress.unit, "kg");

  const latest = await client.logbook.latest({ sport: "strength", exerciseId: "pull_up" });
  assert.equal(latest.id, first.id);
  assert.equal((await client.logbook.latest({ sport: "strength" })).id, second.id);
  assert.equal(await client.logbook.latest({ sport: "bouldering" }), null);
});

test("of two writes to a session, the later edit wins whichever arrives last, and a tie lands the same either way", async () => {
  const client = await athlete();
  const id = crypto.randomUUID();
  const newer = strength([squats(120)]);
  const older = strength([squats(80)]);
  await client.logbook.put({ id, session: newer, editedAt: at("2026-11-10T19:05:00Z") });
  const afterStale = await client.logbook.put({
    id,
    session: older,
    editedAt: at("2026-11-10T19:00:00Z"),
  });
  assert.equal(afterStale.numbers.exercises[0].heaviestKg, 120);
  assert.deepEqual(afterStale.editedAt, at("2026-11-10T19:05:00Z"));

  const tiedAt = at("2026-11-10T19:10:00Z");
  const a = strength([squats(90)]);
  const b = strength([squats(95)]);
  const one = await athlete();
  const other = await athlete();
  await one.logbook.put({ id, session: a, editedAt: tiedAt });
  await one.logbook.put({ id, session: b, editedAt: tiedAt });
  await other.logbook.put({ id, session: b, editedAt: tiedAt });
  await other.logbook.put({ id, session: a, editedAt: tiedAt });
  const kept = (await one.logbook.get({ id })).numbers.exercises[0].heaviestKg;
  assert.equal((await other.logbook.get({ id })).numbers.exercises[0].heaviestKg, kept);

  const future = await errorOf(
    client.logbook.put({ id, session: newer, editedAt: new Date(Date.now() + 60 * 60_000) }),
  );
  assert.equal(future.code, "EDITED_IN_THE_FUTURE");
});

test("a deleted session stays deleted when a device writes it again, and deleting its activity deletes it", async () => {
  const client = await athlete();
  const id = crypto.randomUUID();
  const stored = await client.logbook.put({
    id,
    session: strength([squats()]),
    editedAt: at("2026-11-10T19:00:00Z"),
  });
  const deleted = await client.logbook.delete({ id });
  assert.equal(deleted.id, id);
  assert.deepEqual((await client.activities.list({})).activities, []);
  const again = await errorOf(
    client.logbook.put({ id, session: strength([squats()]), editedAt: at("2026-11-10T19:30:00Z") }),
  );
  assert.equal(again.code, "SESSION_DELETED");
  assert.equal((await errorOf(client.logbook.get({ id }))).code, "SESSION_DELETED");

  const other = crypto.randomUUID();
  const second = await client.logbook.put({
    id: other,
    session: strength([squats()]),
    editedAt: at("2026-11-10T19:00:00Z"),
  });
  assert.notEqual(second.activityId, stored.activityId);
  await client.activities.delete({ id: second.activityId });
  assert.equal((await errorOf(client.logbook.get({ id: other }))).code, "SESSION_DELETED");
});

test("a watch file of the same session links to it as one workout, the logged session standing for it", async () => {
  const client = await athlete();
  const watch = fit({
    start: "2026-11-10T17:02:00Z",
    elapsedSeconds: 70 * 60,
    sport: "training",
    subSport: "strengthTraining",
    heartRate: 118,
  });
  const recorded = await client.activities.upload({ file: watch, source: "apple_health" });
  assert.equal(recorded.sport, "strength");
  const stored = await client.logbook.put({
    id: crypto.randomUUID(),
    session: strength([squats()]),
    editedAt: at("2026-11-10T19:00:00Z"),
  });

  const all = (await client.activities.list({})).activities;
  assert.equal(all.length, 2);
  const logged = all.find(({ id }) => id === stored.activityId);
  assert.equal(logged.primary, true);
  assert.deepEqual(
    logged.duplicates.map(({ id, primary }) => ({ id, primary })),
    [{ id: recorded.id, primary: false }],
  );
  const { activities } = await client.activities.list({ onePerWorkout: true });
  assert.deepEqual(
    activities.map(({ id }) => id),
    [stored.activityId],
  );
  const load = await client.training.load({ from: "2026-11-10", through: "2026-11-10" });
  assert.deepEqual(
    load.days[0].activities.map(({ id, source }) => ({ id, source })),
    [{ id: stored.activityId, source: "rpe" }],
  );

  await client.activities.makePrimary({ id: recorded.id });
  const chosen = await client.activities.list({ onePerWorkout: true });
  assert.deepEqual(
    chosen.activities.map(({ id }) => id),
    [recorded.id],
  );
});

test("a session logged before its watch file arrives links the same way", async () => {
  const client = await athlete();
  const stored = await client.logbook.put({
    id: crypto.randomUUID(),
    session: bouldering([problem()]),
    editedAt: at("2026-11-11T20:00:00Z"),
  });
  const recorded = await client.activities.upload({
    file: fit({
      start: "2026-11-11T18:05:00Z",
      elapsedSeconds: 80 * 60,
      sport: "rockClimbing",
      heartRate: 124,
    }),
    source: "apple_health",
  });
  assert.equal(recorded.sport, "climbing");
  assert.equal(recorded.primary, false);
  assert.deepEqual(
    recorded.duplicates.map(({ id, primary }) => ({ id, primary })),
    [{ id: stored.activityId, primary: true }],
  );
});

test("moving a linked session to another day leaves its watch file behind, whichever write arrives last", async () => {
  const client = await athlete();
  const watch = await client.activities.upload({
    file: fit({
      start: "2026-11-10T17:02:00Z",
      elapsedSeconds: 70 * 60,
      sport: "training",
      subSport: "strengthTraining",
      heartRate: 118,
    }),
    source: "apple_health",
  });
  const tuesday = strength([squats()]);
  const wednesday = strength([squats()], { startedAt: at("2026-11-11T17:00:00Z") });
  const workouts = async () =>
    (await client.activities.list({ onePerWorkout: true })).activities
      .map(({ id, duplicates }) => `${id === watch.id ? "watch" : "logged"} ${duplicates.length}`)
      .sort();

  const moved = crypto.randomUUID();
  await client.logbook.put({ id: moved, session: tuesday, editedAt: at("2026-11-10T19:00:00Z") });
  assert.deepEqual(await workouts(), ["logged 1"]);
  const after = await client.logbook.put({
    id: moved,
    session: wednesday,
    editedAt: at("2026-11-10T19:05:00Z"),
  });
  assert.equal(after.localDay, "2026-11-11");
  assert.deepEqual(await workouts(), ["logged 0", "watch 0"]);
  const load = await client.training.load({ from: "2026-11-10", through: "2026-11-10" });
  assert.ok(!load.days[0].activities.some(({ id }) => id === after.activityId));
  await client.logbook.delete({ id: moved });

  const late = crypto.randomUUID();
  await client.logbook.put({ id: late, session: wednesday, editedAt: at("2026-11-10T19:05:00Z") });
  const stale = await client.logbook.put({
    id: late,
    session: tuesday,
    editedAt: at("2026-11-10T19:00:00Z"),
  });
  assert.equal(stale.localDay, "2026-11-11");
  assert.deepEqual(await workouts(), ["logged 0", "watch 0"]);
});

test("of two writes in flight at once, the later edit decides which watch file the session is linked to", async () => {
  const strengthWatch = (start) =>
    fit({
      start,
      elapsedSeconds: 70 * 60,
      sport: "training",
      subSport: "strengthTraining",
      heartRate: 118,
    });
  const tuesday = strength([squats()]);
  const wednesday = strength([squats()], { startedAt: at("2026-11-11T17:00:00Z") });
  for (let trial = 0; trial < 5; trial++) {
    const client = await athlete();
    const tuesdayWatch = await client.activities.upload({
      file: strengthWatch("2026-11-10T17:02:00Z"),
      source: "apple_health",
    });
    await client.activities.upload({
      file: strengthWatch("2026-11-11T17:02:00Z"),
      source: "apple_health",
    });
    const id = crypto.randomUUID();
    await client.logbook.put({ id, session: tuesday, editedAt: at("2026-11-10T19:00:00Z") });
    await Promise.all([
      client.logbook.put({ id, session: wednesday, editedAt: at("2026-11-10T19:05:00Z") }),
      client.logbook.put({ id, session: tuesday, editedAt: at("2026-11-10T19:10:00Z") }),
    ]);
    const { activityId, localDay } = await client.logbook.get({ id });
    assert.equal(localDay, "2026-11-10");
    const logged = await client.activities.get({ id: activityId });
    assert.deepEqual(
      logged.duplicates.map(({ id: duplicate }) => duplicate),
      [tuesdayWatch.id],
      `trial ${trial}`,
    );
  }
});

test("two sessions logged by hand are never linked by themselves, however they overlap", async () => {
  const client = await athlete();
  const first = await client.logbook.put({
    id: crypto.randomUUID(),
    session: strength([squats()]),
    editedAt: at("2026-11-10T19:00:00Z"),
  });
  const second = await client.logbook.put({
    id: crypto.randomUUID(),
    session: strength([squats(110)], { startedAt: at("2026-11-10T17:02:00Z") }),
    editedAt: at("2026-11-10T19:00:00Z"),
  });
  const { activities } = await client.activities.list({ onePerWorkout: true });
  assert.deepEqual(
    activities.map(({ id, duplicates }) => [id, duplicates.length]).sort(),
    [
      [first.activityId, 0],
      [second.activityId, 0],
    ].sort(),
  );
  const watch = await client.activities.upload({
    file: fit({
      start: "2026-11-10T17:01:00Z",
      elapsedSeconds: 70 * 60,
      sport: "training",
      subSport: "strengthTraining",
      heartRate: 118,
    }),
    source: "apple_health",
  });
  assert.equal(watch.primary, false);
});

test("a session in another sport's time is not linked to it", async () => {
  const client = await athlete();
  await client.logbook.put({
    id: crypto.randomUUID(),
    session: strength([squats()]),
    editedAt: at("2026-11-10T19:00:00Z"),
  });
  const ride = await client.activities.upload({
    file: fit({
      start: "2026-11-10T17:00:00Z",
      elapsedSeconds: 3600,
      sport: "cycling",
      power: 200,
    }),
    source: "upload",
  });
  assert.deepEqual(ride.duplicates, []);
});

test("bouldering sums up its problems by the stated grade table, and the pyramid counts first ascents", async () => {
  const client = await athlete();
  const stored = await client.logbook.put({
    id: crypto.randomUUID(),
    session: bouldering([
      problem({ grade: { scale: "circuit", colour: "Blue" }, outcome: "send", attempts: 3 }),
      problem({ grade: { scale: "v", grade: "V5" }, outcome: "project", attempts: 6 }),
      problem({ grade: { scale: "font", grade: "5+" } }),
      problem({ grade: { scale: "circuit", colour: "Yellow" }, outcome: "repeat", attempts: 1 }),
    ]),
    editedAt: at("2026-11-11T20:00:00Z"),
  });
  assert.deepEqual(stored.summary, {
    sport: "bouldering",
    problems: 4,
    tops: 3,
    sends: 2,
    flashes: 1,
    attempts: 11,
    hardestTop: {
      grade: { scale: "circuit", colour: "Blue" },
      circuit: "Boulderbar",
      font: "6A",
      v: "V3",
    },
    hardestFlash: { grade: { scale: "font", grade: "5+" }, circuit: null, font: "5+", v: "V2" },
  });
  const { activities } = await client.activities.list({});
  assert.equal(activities[0].sport, "bouldering");
  assert.equal(activities[0].indoor, true);
  assert.equal(activities[0].name, "Evening at the wall");

  const progress = await client.logbook.boulderingProgress({
    from: "2026-11-01",
    through: "2026-11-30",
    scale: "v",
  });
  assert.deepEqual(progress.pyramid, {
    steps: [
      { grade: "V5", flashes: 0, sends: 0, projects: 1, attempts: 6 },
      { grade: "V3", flashes: 0, sends: 1, projects: 0, attempts: 3 },
      { grade: "V2", flashes: 1, sends: 0, projects: 0, attempts: 1 },
    ],
    ungraded: 0,
  });
  assert.deepEqual(progress.circuits, ["Boulderbar"]);
  assert.equal(progress.sessions[0].hardestTop.v, "V3");

  const colours = await client.logbook.boulderingProgress({
    from: "2026-11-01",
    through: "2026-11-30",
    scale: { circuit: "Boulderbar" },
  });
  assert.deepEqual(
    colours.pyramid.steps.map(({ grade }) => grade),
    ["Blue"],
  );
  assert.equal(colours.pyramid.ungraded, 2);
});

test("the athlete's own exercise is refused until it exists, and then counts as used", async () => {
  const client = await athlete();
  const exerciseId = crypto.randomUUID();
  const session = strength([
    { exerciseId, group: null, notes: null, sets: [set({ load: kg(30) })] },
  ]);
  const refused = await errorOf(
    client.logbook.put({ id: crypto.randomUUID(), session, editedAt: at("2026-11-10T19:00:00Z") }),
  );
  assert.equal(refused.code, "UNKNOWN_EXERCISE");
  assert.deepEqual(refused.data, { exerciseId });

  const exercise = {
    name: "Landmine press",
    equipment: "barbell",
    primaryMuscles: ["front_delts"],
    secondaryMuscles: ["triceps"],
    measure: "reps",
    bodyweight: false,
  };
  await client.logbook.putExercise({
    id: exerciseId,
    exercise,
    editedAt: at("2026-11-10T18:00:00Z"),
  });
  const renamed = await client.logbook.putExercise({
    id: exerciseId,
    exercise: { ...exercise, name: "Old name" },
    editedAt: at("2026-11-10T17:00:00Z"),
  });
  assert.equal(renamed.name, "Landmine press");
  await client.logbook.put({
    id: crypto.randomUUID(),
    session,
    editedAt: at("2026-11-10T19:00:00Z"),
  });

  const exercises = await client.logbook.exercises({});
  assert.ok(exercises.catalogue.some(({ id }) => id === "back_squat"));
  assert.deepEqual(
    exercises.custom.map(({ id, name }) => ({ id, name })),
    [{ id: exerciseId, name: "Landmine press" }],
  );
  assert.deepEqual(exercises.used, [{ exerciseId, sessions: 1, lastDay: "2026-11-10" }]);
});

test("a session another athlete logs is not theirs to read", async () => {
  const owner = await athlete();
  const stranger = await athlete();
  const id = crypto.randomUUID();
  await owner.logbook.put({
    id,
    session: strength([squats()]),
    editedAt: at("2026-11-10T19:00:00Z"),
  });
  assert.equal((await errorOf(stranger.logbook.get({ id }))).code, "NOT_FOUND");
});
