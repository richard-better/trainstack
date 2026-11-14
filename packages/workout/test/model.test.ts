import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CuePlacementError, flatten, totals, type Workout, workoutSchema } from "../src/index.ts";

const easy = {
  type: "step",
  duration: { type: "time", seconds: 60 },
  target: { type: "power", unit: "ftp", level: { kind: "constant", value: 0.5 } },
} as const;

describe("workoutSchema", () => {
  test("holds runs, swims and heart rate targets as well as rides", () => {
    const swim: Workout = {
      name: "CSS sets",
      sport: "swimming",
      steps: [
        {
          type: "repeat",
          count: 8,
          name: "Main set",
          steps: [
            {
              type: "step",
              duration: { type: "distance", meters: 100 },
              target: {
                type: "pace",
                unit: "metersPerSecond",
                level: { kind: "range", low: 1.25, high: 1.3 },
              },
              notes: "Hold form on the last 25",
            },
            { type: "step", duration: { type: "time", seconds: 15 }, intensity: "rest" },
          ],
        },
        {
          type: "step",
          duration: { type: "time", seconds: 600 },
          target: { type: "heartRate", unit: "bpm", level: { kind: "range", low: 130, high: 145 } },
          intensity: "coolDown",
        },
      ],
    };
    assert.deepEqual(workoutSchema.parse(swim), swim);
  });

  for (const [label, workout] of [
    ["no steps", { name: "Empty", sport: "cycling", steps: [] }],
    ["an unknown sport", { name: "Row", sport: "rowing", steps: [easy] }],
    [
      "a range that runs backwards",
      {
        name: "Odd",
        sport: "cycling",
        steps: [
          {
            ...easy,
            target: { type: "power", unit: "ftp", level: { kind: "range", low: 1, high: 0.9 } },
          },
        ],
      },
    ],
    [
      "a zero-length step",
      {
        name: "Odd",
        sport: "cycling",
        steps: [{ ...easy, duration: { type: "time", seconds: 0 } }],
      },
    ],
    [
      "a repeat with no count",
      { name: "Odd", sport: "cycling", steps: [{ type: "repeat", count: 0, steps: [easy] }] },
    ],
    [
      "an empty nested repeat",
      {
        name: "Odd",
        sport: "cycling",
        steps: [{ type: "repeat", count: 2, steps: [{ type: "repeat", count: 2, steps: [] }] }],
      },
    ],
    [
      "a repeat cue after the repeat ends, even inside another repeat",
      {
        name: "Odd",
        sport: "cycling",
        steps: [
          {
            type: "repeat",
            count: 2,
            steps: [
              {
                type: "repeat",
                count: 2,
                cues: [{ at: { type: "time", seconds: 121 }, text: "Too late" }],
                steps: [easy],
              },
            ],
          },
        ],
      },
    ],
    [
      "a repeat cue by time over steps measured in distance",
      {
        name: "Odd",
        sport: "running",
        steps: [
          {
            type: "repeat",
            count: 2,
            cues: [{ at: { type: "time", seconds: 10 }, text: "By time" }],
            steps: [{ type: "step", duration: { type: "distance", meters: 400 } }],
          },
        ],
      },
    ],
  ] as [string, unknown][]) {
    test(`rejects ${String(label)}`, () => {
      assert.equal(workoutSchema.safeParse(workout).success, false);
    });
  }

  test("says why a repeat cue cannot be placed, and accepts one at the repeat's very end", () => {
    const repeatWithCueAt = (seconds: number): Workout => ({
      name: "Cued",
      sport: "cycling",
      steps: [
        {
          type: "repeat",
          count: 2,
          cues: [{ at: { type: "time", seconds }, text: "Cue" }],
          steps: [easy],
        },
      ],
    });
    const late = workoutSchema.safeParse(repeatWithCueAt(121));
    assert.equal(late.success, false);
    assert.deepEqual(
      late.error?.issues.map((issue) => [issue.path, issue.message]),
      [[["steps"], "A cue 121 seconds into a repeat comes after the repeat ends"]],
    );
    assert.equal(workoutSchema.safeParse(repeatWithCueAt(120)).success, true);
  });
});

describe("flatten", () => {
  test("expands nested repeats in order", () => {
    const hard = { ...easy, duration: { type: "time", seconds: 30 } } as const;
    assert.deepEqual(
      flatten([
        easy,
        { type: "repeat", count: 2, steps: [hard, { type: "repeat", count: 2, steps: [easy] }] },
      ]),
      [easy, hard, easy, easy, hard, easy, easy],
    );
  });

  test("fires a repeat's cue once, in the step it falls in", () => {
    const steps = flatten([
      {
        type: "repeat",
        count: 3,
        cues: [
          { at: { type: "time", seconds: 120 }, text: "Last one" },
          { at: { type: "time", seconds: 180 }, text: "Done" },
        ],
        steps: [{ ...easy, cues: [{ at: { type: "time", seconds: 5 }, text: "Go" }] }],
      },
    ]);
    assert.deepEqual(
      steps.map((step) => step.cues),
      [
        [{ at: { type: "time", seconds: 5 }, text: "Go" }],
        [{ at: { type: "time", seconds: 5 }, text: "Go" }],
        [
          { at: { type: "time", seconds: 0 }, text: "Last one" },
          { at: { type: "time", seconds: 5 }, text: "Go" },
          { at: { type: "time", seconds: 60 }, text: "Done" },
        ],
      ],
    );
  });

  test("refuses a repeat cue it cannot place", () => {
    assert.throws(
      () =>
        flatten([
          {
            type: "repeat",
            count: 2,
            cues: [{ at: { type: "time", seconds: 500 }, text: "Too late" }],
            steps: [easy],
          },
        ]),
      CuePlacementError,
    );
    assert.throws(
      () =>
        flatten([
          {
            type: "repeat",
            count: 2,
            cues: [{ at: { type: "time", seconds: 10 }, text: "By time" }],
            steps: [{ type: "step", duration: { type: "distance", meters: 400 } }],
          },
        ]),
      CuePlacementError,
    );
  });
});

test("totals add up time and distance through repeats", () => {
  assert.deepEqual(
    totals([
      easy,
      {
        type: "repeat",
        count: 4,
        steps: [easy, { type: "step", duration: { type: "distance", meters: 400 } }],
      },
    ]),
    { seconds: 300, meters: 1600 },
  );
});

test("a workout cannot expand past the step limit, so a file cannot exhaust memory", () => {
  const huge: Workout = {
    name: "Huge",
    sport: "cycling",
    steps: [{ type: "repeat", count: 1_000_000_000, steps: [easy] }],
  };
  assert.equal(workoutSchema.safeParse(huge).success, false);
  assert.throws(() => flatten(huge.steps), RangeError);
  assert.equal(
    workoutSchema.safeParse({ ...huge, steps: [{ type: "repeat", count: 10_000, steps: [easy] }] })
      .success,
    true,
  );
});
