import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, before, test } from "node:test";
import {
  blankBouldering,
  blankStrength,
  draftOf,
  durationOf,
  exerciseChoices,
  exerciseFromHistory,
  formatMass,
  groupWithNext,
  movedExercise,
  gradeValueText,
  loggedFigures,
  nextSet,
  problemsWith,
  repeatStrength,
  sessionOf,
  startOf,
  withWholeGroups,
} from "../hosted/apps/account/src/lib/logbook.ts";
import { activityTitle, sportName } from "../hosted/apps/account/src/lib/sports.ts";
import { mockApple } from "./helpers/apple.mjs";
import { signInOnTheWeb as signInWithApple } from "./helpers/web.mjs";
import { migrate, startWorker } from "./helpers/worker.mjs";

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

const signInOnTheWeb = () => signInWithApple(runtime, apple);

const evening = new Date(2026, 10, 10, 18, 0);

function squatDraft(unit = "kg") {
  const draft = blankStrength(unit, evening);
  const squat = exerciseFromHistory("back_squat", null, unit, []);
  squat.sets[0] = { ...squat.sets[0], mass: "100", reps: "5", rpe: "8" };
  squat.sets.push(nextSet(squat.sets, squat.sets[0]));
  return { ...draft, minutes: "60", rpe: 7, exercises: [squat] };
}

test("a strength session logged on the web reads back as the same draft, and the next one repeats it", async () => {
  const { webApp } = await signInOnTheWeb();
  const draft = squatDraft();
  const { session, problem } = problemsWith(draft);
  assert.equal(problem, null);
  assert.equal(session.detail.exercises[0].sets.length, 2);
  const id = crypto.randomUUID();
  const stored = await webApp.logbook.put({ id, session, editedAt: new Date() });

  assert.deepEqual(sessionOf(draftOf(stored, "kg")), session);

  const { activities } = await webApp.activities.list({ onePerWorkout: true });
  assert.equal(activityTitle(activities[0]), "Evening strength session");
  assert.equal(sportName(activities[0].sport).family, "strength");
  assert.deepEqual(
    loggedFigures(activities[0].logged.summary).map(
      ({ label, value, unit }) => `${label} ${value}${unit}`,
    ),
    ["Sets 2", "Volume 1,000kg"],
  );

  const latest = await webApp.logbook.latest({ sport: "strength" });
  const repeated = repeatStrength(blankStrength("kg", new Date()), latest);
  assert.deepEqual(
    repeated.exercises.map(({ exerciseId, sets }) => [
      exerciseId,
      sets.map(({ mass, reps }) => `${mass}×${reps}`),
    ]),
    [["back_squat", ["100×5", "100×5"]]],
  );
  const again = await webApp.logbook.latest({ sport: "strength", exerciseId: "back_squat" });
  const added = exerciseFromHistory("back_squat", again, "kg", []);
  assert.deepEqual(
    added.sets.map(({ mass }) => mass),
    ["100", "100"],
  );
});

test("a lifter who logs in pounds reads pounds back", async () => {
  const { webApp } = await signInOnTheWeb();
  const draft = squatDraft("lb");
  draft.exercises[0].sets = draft.exercises[0].sets.map((set) => ({ ...set, mass: "225" }));
  const stored = await webApp.logbook.put({
    id: crypto.randomUUID(),
    session: problemsWith(draft).session,
    editedAt: new Date(),
  });
  assert.equal(stored.summary.unit, "lb");
  const back = draftOf(stored, "kg");
  assert.equal(back.unit, "lb");
  assert.deepEqual(
    back.exercises[0].sets.map(({ mass, unit }) => `${mass} ${unit}`),
    ["225 lb", "225 lb"],
  );
  assert.equal(formatMass(stored.numbers.exercises[0].heaviestKg, "lb"), "225 lb");
});

test("blank sets are left out, and a set that is not right says which", () => {
  const draft = squatDraft();
  draft.exercises[0].sets.push(nextSet([], { ...draft.exercises[0].sets[0], reps: "", mass: "" }));
  assert.equal(problemsWith(draft).session.detail.exercises[0].sets.length, 2);
  draft.exercises[0].sets[1] = { ...draft.exercises[0].sets[1], rpe: "8.3" };
  assert.equal(problemsWith(draft).problem, "Back squat set 2: in steps of a half.");
});

test("left blank, the duration runs from the start until now", () => {
  const timing = { day: "2026-11-10", time: "18:00", minutes: "" };
  assert.equal(startOf(timing).getHours(), 18);
  assert.equal(durationOf(timing, new Date(2026, 10, 10, 19, 12)), 72 * 60);
  assert.equal(durationOf({ ...timing, minutes: "45" }), 45 * 60);
});

test("a bouldering session logged on the web sums up in its own words", async () => {
  const { webApp } = await signInOnTheWeb();
  const draft = {
    ...blankBouldering(evening),
    minutes: "90",
    venueName: "Boulderbar",
    circuit: {
      name: "Boulderbar",
      colours: [
        { name: "Green", from: "5+", to: "6A" },
        { name: "Black", from: null, to: null },
      ],
    },
    problems: [
      {
        key: "a",
        grade: { scale: "circuit", colour: "Green" },
        name: null,
        attempts: 1,
        outcome: "flash",
        styles: [],
        angle: null,
        notes: null,
        restSeconds: null,
      },
      {
        key: "b",
        grade: { scale: "circuit", colour: "Black" },
        name: null,
        attempts: 4,
        outcome: "project",
        styles: ["crimpy"],
        angle: "overhang",
        notes: null,
        restSeconds: 180,
      },
    ],
  };
  const stored = await webApp.logbook.put({
    id: crypto.randomUUID(),
    session: problemsWith(draft).session,
    editedAt: new Date(),
  });
  assert.equal(gradeValueText(stored.summary.hardestTop), "Green (5+)");
  assert.deepEqual(
    loggedFigures(stored.summary).map(({ label, value }) => `${label} ${value}`),
    ["Tops 1/2", "Hardest Green (5+)"],
  );
  assert.deepEqual(sessionOf(draftOf(stored, "kg")), problemsWith(draft).session);
});

test("the exercise search puts what the athlete did lately first", () => {
  const choices = exerciseChoices("press", [], [{ exerciseId: "overhead_press" }]);
  assert.equal(choices[0].id, "overhead_press");
  assert.ok(choices.every(({ name }) => name.toLowerCase().includes("press")));
});

test("a set from history in another unit is converted into the draft's unit, not relabelled", () => {
  const latest = {
    session: {
      detail: {
        sport: "strength",
        exercises: [
          {
            exerciseId: "bench_press",
            group: null,
            notes: null,
            sets: [
              {
                kind: "working",
                reps: 5,
                seconds: null,
                load: { kind: "weight", weight: { value: 225, unit: "lb" } },
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
  };
  const [set] = exerciseFromHistory("bench_press", latest, "kg", []).sets;
  assert.deepEqual([set.mass, set.unit], ["102.06", "kg"]);
  const [same] = exerciseFromHistory("bench_press", latest, "lb", []).sets;
  assert.deepEqual([same.mass, same.unit], ["225", "lb"]);
});

test("joining an exercise to a superset takes in the whole superset after it", () => {
  const entry = (exerciseId) => exerciseFromHistory(exerciseId, null, "kg", []);
  const list = groupWithNext(
    [entry("bench_press"), entry("barbell_row"), entry("face_pull")],
    1,
    true,
  );
  const joined = groupWithNext(list, 0, true);
  assert.equal(new Set(joined.map(({ group }) => group)).size, 1);
  assert.notEqual(joined[0].group, null);
});

test("moving or removing an exercise keeps the supersets it does not split", () => {
  const entry = (exerciseId) => exerciseFromHistory(exerciseId, null, "kg", []);
  let list = [entry("bench_press"), entry("barbell_row"), entry("back_squat"), entry("deadlift")];
  list = groupWithNext(list, 0, true);
  const groups = (entries) =>
    entries.map(({ exerciseId, group }) => `${exerciseId}:${group ?? "-"}`);
  assert.deepEqual(groups(movedExercise(list, 3, -1)), [
    "bench_press:1",
    "barbell_row:1",
    "deadlift:-",
    "back_squat:-",
  ]);
  assert.deepEqual(groups(movedExercise(list, 2, -1)), [
    "bench_press:-",
    "back_squat:-",
    "barbell_row:-",
    "deadlift:-",
  ]);
  assert.deepEqual(groups(withWholeGroups(list.filter((_, index) => index !== 1))), [
    "bench_press:-",
    "back_squat:-",
    "deadlift:-",
  ]);
});
