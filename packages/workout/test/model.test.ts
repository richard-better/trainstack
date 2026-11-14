import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CuePlacementError,
  flatten,
  type MeasuredDuration,
  type Step,
  totals,
  type Workout,
  workoutSchema,
} from "../src/index.ts";

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
    {
      seconds: 300,
      meters: 1600,
      open: { steps: 0, withoutExpected: 0, expectedSeconds: 0, expectedMeters: 0 },
    },
  );
});

const lap = (expected?: MeasuredDuration): Step => ({
  type: "step",
  duration: expected ? { type: "open", expected } : { type: "open" },
});

describe("lap-button steps", () => {
  test("hold any target but a ramp, with or without an expected length", () => {
    const workout: Workout = {
      name: "Tempo on lap",
      sport: "running",
      steps: [
        { ...lap({ type: "time", seconds: 600 }), intensity: "warmUp" },
        {
          ...lap({ type: "distance", meters: 1000 }),
          target: {
            type: "pace",
            unit: "threshold",
            level: { kind: "range", low: 0.9, high: 0.95 },
          },
        },
        { ...lap(), target: { type: "maxEffort" } },
      ],
    };
    assert.deepEqual(workoutSchema.parse(workout), workout);
    const ramp = {
      ...workout,
      steps: [
        {
          ...lap({ type: "time", seconds: 600 }),
          target: { type: "power", unit: "ftp", level: { kind: "ramp", from: 0.5, to: 0.7 } },
        },
      ],
    };
    const parsed = workoutSchema.safeParse(ramp);
    assert.equal(parsed.success, false);
    assert.match(parsed.error!.issues[0]!.message, /cannot ramp/);
    assert.equal(
      workoutSchema.safeParse({ ...workout, steps: [lap({ type: "time", seconds: 0 })] }).success,
      false,
    );
  });

  test("totals keep the certain time and distance apart from what lap-button steps are expected to take", () => {
    assert.deepEqual(
      totals([
        lap({ type: "time", seconds: 600 }),
        easy,
        {
          type: "repeat",
          count: 3,
          steps: [easy, lap(), lap({ type: "distance", meters: 200 })],
        },
      ]),
      {
        seconds: 240,
        meters: 0,
        open: { steps: 7, withoutExpected: 3, expectedSeconds: 600, expectedMeters: 600 },
      },
    );
  });

  test("flatten places a repeat cue that falls at or after a lap-button step's start in that step", () => {
    const steps = flatten([
      {
        type: "repeat",
        count: 2,
        steps: [easy, lap()],
        cues: [
          { at: { type: "time", seconds: 30 }, text: "Settle" },
          { at: { type: "time", seconds: 900 }, text: "Press lap when ready" },
        ],
      },
    ]);
    assert.deepEqual(
      steps.map((step) => step.cues?.map((cue) => [cue.text, cue.at])),
      [
        [["Settle", { type: "time", seconds: 30 }]],
        [["Press lap when ready", { type: "time", seconds: 840 }]],
        undefined,
        undefined,
      ],
    );
  });
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

test("a workout cannot carry more than a thousand cues, so a file cannot exhaust the CPU", () => {
  const cued = (count: number): Workout => ({
    name: "Chatty",
    sport: "cycling",
    steps: [
      {
        type: "repeat",
        count: 10_000,
        cues: Array.from({ length: count }, () => ({
          at: { type: "time", seconds: 0 },
          text: "Go",
        })),
        steps: [easy],
      },
    ],
  });
  const tooMany = workoutSchema.safeParse(cued(1001));
  assert.deepEqual(
    tooMany.error?.issues.map((issue) => issue.message),
    ["A workout can have at most 1000 cues"],
  );
  assert.equal(workoutSchema.safeParse(cued(1000)).success, true);
});
