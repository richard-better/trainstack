import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  catalogueExercise,
  epleyOneRepMax,
  exerciseCatalogue,
  exerciseNumbers,
  KILOGRAMS_PER_POUND,
  type LoggedExercise,
  loggedSessionSchema,
  personalRecords,
  type StrengthDetail,
  strengthDetailSchema,
  type StrengthSet,
  strengthSummary,
} from "../src/index.ts";

const set = (overrides: Partial<StrengthSet> = {}): StrengthSet => ({
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

const exercise = (exerciseId: string, sets: StrengthSet[], group: number | null = null) =>
  ({ exerciseId, group, notes: null, sets }) satisfies LoggedExercise;

describe("strengthDetailSchema", () => {
  test("holds what lifters record: warm-ups, RPE, reps in reserve, tempo, rest and supersets", () => {
    const detail: StrengthDetail = {
      sport: "strength",
      exercises: [
        exercise("back_squat", [
          set({
            kind: "warm_up",
            reps: 5,
            load: { kind: "weight", weight: { value: 60, unit: "kg" } },
          }),
          set({ rpe: 8.5, repsInReserve: 1, tempo: "3-1-X-0", restSeconds: 180 }),
        ]),
        exercise(
          "pull_up",
          [set({ load: { kind: "weighted", added: { value: 25, unit: "lb" } } })],
          1,
        ),
        exercise(
          "dip",
          [set({ load: { kind: "assisted", assistance: { value: 10, unit: "kg" } } })],
          1,
        ),
        exercise("plank", [set({ reps: null, seconds: 60, load: { kind: "bodyweight" } })]),
      ],
    };
    assert.deepEqual(strengthDetailSchema.parse(detail), detail);
  });

  test("refuses a group split by another exercise, as it would not be done together", () => {
    const result = strengthDetailSchema.safeParse({
      sport: "strength",
      exercises: [
        exercise("bench_press", [set()], 1),
        exercise("deadlift", [set()]),
        exercise("barbell_row", [set()], 1),
      ],
    });
    assert.equal(result.success, false);
  });

  test("refuses a slug the catalogue does not have, and takes the athlete's own exercise by UUID", () => {
    const parse = (exerciseId: string) =>
      strengthDetailSchema.safeParse({
        sport: "strength",
        exercises: [exercise(exerciseId, [set()])],
      }).success;
    assert.equal(parse("bench_pres"), false);
    assert.equal(parse("bench_press"), true);
    assert.equal(parse(crypto.randomUUID()), true);
  });

  test("refuses a set with neither reps nor a time, an RPE off the half steps, and a malformed tempo", () => {
    for (const bad of [
      set({ reps: null, seconds: null }),
      set({ rpe: 8.3 }),
      set({ tempo: "31X0" }),
    ]) {
      const result = strengthDetailSchema.safeParse({
        sport: "strength",
        exercises: [exercise("bench_press", [bad])],
      });
      assert.equal(result.success, false, JSON.stringify(bad));
    }
  });

  test("keeps pounds as pounds, so a lifter's 225 lb reads back as 225 lb", () => {
    const parsed = strengthDetailSchema.parse({
      sport: "strength",
      exercises: [
        exercise("bench_press", [
          set({ load: { kind: "weight", weight: { value: 225, unit: "lb" } } }),
        ]),
      ],
    });
    assert.deepEqual(parsed.exercises[0]!.sets[0]!.load, {
      kind: "weight",
      weight: { value: 225, unit: "lb" },
    });
  });

  test("a logged session takes a session RPE in halves from 0 to 10", () => {
    const session = {
      startedAt: new Date("2026-11-10T17:00:00Z"),
      durationSeconds: 3600,
      name: null,
      notes: null,
      rpe: 7.5,
      detail: { sport: "strength", exercises: [] },
    };
    assert.equal(loggedSessionSchema.safeParse(session).success, true);
    assert.equal(loggedSessionSchema.safeParse({ ...session, rpe: 11 }).success, false);
  });
});

describe("the exercise catalogue", () => {
  test("names each lift once, with the muscles it trains", () => {
    const ids = exerciseCatalogue.map(({ id }) => id);
    assert.equal(new Set(ids).size, ids.length);
    for (const lift of exerciseCatalogue) assert.ok(lift.primaryMuscles.length > 0, lift.id);
    assert.deepEqual(catalogueExercise("back_squat")?.primaryMuscles, ["quads", "glutes"]);
    assert.equal(catalogueExercise("pull_up")?.bodyweight, true);
    assert.equal(catalogueExercise("plank")?.measure, "time");
  });
});

describe("exercise numbers", () => {
  test("Epley estimates a one-rep max as weight times one plus reps over 30, up to 12 reps", () => {
    assert.equal(epleyOneRepMax(100, 1), 100);
    assert.equal(epleyOneRepMax(100, 5), 100 * (1 + 5 / 30));
    assert.equal(epleyOneRepMax(100, 13), null);
    assert.equal(epleyOneRepMax(100, 0), null);
  });

  test("volume is reps times weight over working sets, warm-ups left out", () => {
    const numbers = exerciseNumbers(
      exercise("back_squat", [
        set({
          kind: "warm_up",
          reps: 10,
          load: { kind: "weight", weight: { value: 40, unit: "kg" } },
        }),
        set({ reps: 5 }),
        set({ reps: 3, load: { kind: "weight", weight: { value: 110, unit: "kg" } } }),
        set({ kind: "drop", reps: 8, load: { kind: "weight", weight: { value: 80, unit: "kg" } } }),
      ]),
    );
    assert.equal(numbers.sets, 3);
    assert.equal(numbers.reps, 16);
    assert.equal(numbers.volumeKg, 500 + 330 + 640);
    assert.equal(numbers.heaviestKg, 110);
    assert.equal(numbers.estimatedOneRepMaxKg, 110 * 1.1);
  });

  test("a hang held with added weight counts toward the heaviest load", () => {
    const numbers = exerciseNumbers(
      exercise("hangboard_hang", [
        set({
          reps: null,
          seconds: 10,
          load: { kind: "weight", weight: { value: 20, unit: "kg" } },
        }),
      ]),
    );
    assert.equal(numbers.heaviestKg, 20);
    assert.equal(numbers.longestSeconds, 10);
  });

  test("pounds convert at 0.45359237 kg each", () => {
    const numbers = exerciseNumbers(
      exercise("bench_press", [
        set({ reps: 1, load: { kind: "weight", weight: { value: 225, unit: "lb" } } }),
      ]),
    );
    assert.equal(numbers.heaviestKg, 225 * KILOGRAMS_PER_POUND);
  });

  test("bodyweight sets count the body's mass when it is known, and only reps when it is not", () => {
    const pullUps = exercise("pull_up", [
      set({ reps: 5, load: { kind: "weighted", added: { value: 20, unit: "kg" } } }),
      set({ reps: 8, load: { kind: "bodyweight" } }),
      set({ reps: 10, load: { kind: "assisted", assistance: { value: 30, unit: "kg" } } }),
    ]);
    const known = exerciseNumbers(pullUps, 70);
    assert.equal(known.volumeKg, 5 * 90 + 8 * 70 + 10 * 40);
    assert.equal(known.heaviestKg, 90);
    const unknown = exerciseNumbers(pullUps, null);
    assert.equal(unknown.volumeKg, null);
    assert.equal(unknown.estimatedOneRepMaxKg, null);
    assert.equal(unknown.reps, 23);
    assert.equal(unknown.mostReps, 10);
  });

  test("a session sums an exercise done twice, and says which unit the lifter used most", () => {
    const summary = strengthSummary({
      sport: "strength",
      exercises: [
        exercise("bench_press", [
          set({ load: { kind: "weight", weight: { value: 135, unit: "lb" } } }),
        ]),
        exercise("barbell_row", [
          set({ load: { kind: "weight", weight: { value: 95, unit: "lb" } } }),
        ]),
        exercise("bench_press", [
          set({ load: { kind: "weight", weight: { value: 60, unit: "kg" } } }),
        ]),
      ],
    });
    assert.equal(summary.exercises, 2);
    assert.equal(summary.sets, 3);
    assert.equal(summary.unit, "lb");
  });
});

describe("personal records", () => {
  test("a session sets a record when it beats every earlier session of the lift, not on the first", () => {
    const first = exerciseNumbers(exercise("deadlift", [set({ reps: 5 })]));
    const second = exerciseNumbers(
      exercise("deadlift", [
        set({ reps: 3, load: { kind: "weight", weight: { value: 120, unit: "kg" } } }),
      ]),
    );
    assert.deepEqual(personalRecords([first], []), []);
    const records = personalRecords([second], [first]);
    assert.deepEqual(
      records.map(({ kind }) => kind),
      ["estimated_one_rep_max", "heaviest"],
    );
    assert.equal(records[1]!.previous, 100);
  });
});
