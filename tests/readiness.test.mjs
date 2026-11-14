import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
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
  const signedIn = await apple.signIn(runtime, { email: `${randomUUID()}@example.com` });
  const client = rpcClient(runtime, { token: signedIn.token });
  await client.settings.setTimeZone({ timeZone: "UTC" });
  return client;
}

let clock = Date.now() - 3_600_000;
const edited = () => new Date((clock += 1000));

const shifted = (day, days) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const normal = { sleep: 3, energy: 3, soreness: 3, stress: 3, mood: 3 };

const checkIn = (day, answers = {}) => ({
  day,
  ratings: normal,
  illness: null,
  injury: null,
  note: null,
  ...answers,
  updatedAt: edited(),
});

const steadyRide = (watts) => ({
  name: "Threshold hour",
  sport: "cycling",
  steps: [
    {
      type: "step",
      duration: { type: "time", seconds: 3600 },
      target: { type: "power", unit: "watts", level: { kind: "constant", value: watts } },
    },
  ],
});

const plan = (client, day, watts) =>
  client.plannedWorkouts.put({
    id: randomUUID(),
    day,
    position: 1,
    content: { kind: "workout", workout: steadyRide(watts), source: null, notes: null },
    updatedAt: edited(),
  });

const logged = (client, day, { rpe, minutes, id = randomUUID() }) =>
  client.logbook.put({
    id,
    session: {
      startedAt: new Date(`${day}T07:00:00Z`),
      durationSeconds: minutes * 60,
      name: null,
      notes: null,
      rpe,
      detail: {
        sport: "strength",
        exercises: [
          {
            exerciseId: "back_squat",
            group: null,
            notes: null,
            sets: [
              {
                kind: "working",
                reps: 5,
                seconds: null,
                load: { kind: "weight", weight: { value: 100, unit: "kg" } },
                rpe: null,
                repsInReserve: null,
                tempo: null,
                restSeconds: null,
              },
            ],
          },
        ],
      },
    },
    editedAt: edited(),
  });

async function todayOf(client) {
  const { today } = await client.readiness.range({ from: "2026-01-01", through: "2026-01-01" });
  return today;
}

async function readinessOn(client, day) {
  const { days } = await client.readiness.range({ from: day, through: day });
  return days[0];
}

test("readiness follows a new check-in at once, and suggests what to change about today's plan", async () => {
  const client = await athlete();
  const today = await todayOf(client);
  await client.settings.write({
    writes: [
      {
        day: "2026-01-01",
        change: { kind: "threshold", sport: null, threshold: "ftp", value: 200 },
        updatedAt: edited(),
      },
    ],
  });
  const planned = await plan(client, today, 190);
  assert.ok(planned.planned.load > 85);

  const nothing = await readinessOn(client, today);
  assert.equal(nothing.level, null);
  assert.equal(nothing.confidence, "low");
  assert.deepEqual(nothing.suggestions, []);
  assert.deepEqual(nothing.gaps, [{ kind: "no_check_in" }, { kind: "no_training" }]);
  assert.deepEqual(nothing.basis.unmeasured, ["sleep", "resting_heart_rate", "hrv"]);

  await client.checkIns.put(checkIn(today));
  const normalDay = await readinessOn(client, today);
  assert.equal(normalDay.level, "ready");
  assert.equal(normalDay.confidence, "medium");
  assert.deepEqual(normalDay.suggestions, [
    {
      plannedId: planned.id,
      intensity: "hard",
      action: "as_planned",
      plannedLoad: planned.planned.load,
      plannedSeconds: 3600,
    },
  ]);

  await client.checkIns.put(checkIn(today, { ratings: { ...normal, sleep: 1 } }));
  const poorNight = await readinessOn(client, today);
  assert.equal(poorNight.level, "fair");
  assert.equal(poorNight.reasons[0].item, "sleep");
  assert.equal(poorNight.suggestions[0].action, "ease");

  await client.checkIns.put(checkIn(today, { illness: { kind: "fever" } }));
  const ill = await readinessOn(client, today);
  assert.equal(ill.level, "poor");
  assert.deepEqual(ill.reasons[0], { kind: "ill", illness: "fever" });
  assert.equal(ill.suggestions[0].action, "rest");

  await client.plannedWorkouts.skip({
    id: planned.id,
    skipped: { reason: "Fever" },
    updatedAt: edited(),
  });
  assert.deepEqual((await readinessOn(client, today)).suggestions, []);
});

test("training load counts from the day before, and follows a session that changes", async () => {
  const client = await athlete();
  const today = await todayOf(client);
  for (let back = 100; back >= 4; back--) {
    await logged(client, shifted(today, -back), { rpe: 5, minutes: 60 });
  }
  const yesterday = randomUUID();
  await logged(client, shifted(today, -3), { rpe: 9, minutes: 120 });
  await logged(client, shifted(today, -2), { rpe: 9, minutes: 120 });
  await logged(client, shifted(today, -1), { rpe: 9, minutes: 120, id: yesterday });
  await client.checkIns.put(checkIn(today));

  const hard = await readinessOn(client, today);
  assert.equal(hard.basis.trainingDays, 100);
  const hardDays = hard.reasons.find((reason) => reason.kind === "hard_days");
  assert.equal(hardDays?.days, 3);
  assert.equal(hard.reasons.find((reason) => reason.kind === "form")?.band, "deep");
  assert.equal(hard.level, "fair");

  await logged(client, today, { rpe: 10, minutes: 180 });
  assert.deepEqual(await readinessOn(client, today), hard, "today's own session is not counted");

  await logged(client, shifted(today, -1), { rpe: 2, minutes: 30, id: yesterday });
  const eased = await readinessOn(client, today);
  assert.equal(
    eased.reasons.find((reason) => reason.kind === "hard_days"),
    undefined,
  );
});

test("a range ends at today, and the check-ins before it make the athlete's usual", async () => {
  const client = await athlete();
  const today = await todayOf(client);
  for (let back = 10; back >= 1; back--) {
    await client.checkIns.put(
      checkIn(shifted(today, -back), { ratings: { ...normal, energy: 4 } }),
    );
  }
  await client.checkIns.put(checkIn(today));
  const { days } = await client.readiness.range({
    from: shifted(today, -2),
    through: shifted(today, 30),
  });
  assert.deepEqual(
    days.map(({ day }) => day),
    [shifted(today, -2), shifted(today, -1), today],
  );
  const energy = days[2].reasons.find((reason) => reason.item === "energy");
  assert.equal(energy.usual, 4);
  assert.equal(energy.against, "own");
  assert.equal(energy.effect, "lowers");
  assert.equal(days[2].basis.baselineCheckIns, 10);

  const future = await client.readiness.range({
    from: shifted(today, 1),
    through: shifted(today, 7),
  });
  assert.deepEqual(future, { today, days: [] });
});

test("a range is at most 92 days, and readiness is only the athlete's own", async () => {
  const one = await athlete();
  const two = await athlete();
  const today = await todayOf(one);
  await assert.rejects(one.readiness.range({ from: "2026-01-01", through: "2026-04-03" }), {
    code: "BAD_REQUEST",
  });
  await one.checkIns.put(checkIn(today, { illness: { kind: "stomach" } }));
  assert.equal((await readinessOn(one, today)).level, "poor");
  assert.equal((await readinessOn(two, today)).level, null);
  await assert.rejects(rpcClient(runtime).readiness.range({ from: today, through: today }), {
    code: "UNAUTHORIZED",
    status: 401,
  });
});
