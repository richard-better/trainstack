import { describe, expect, test } from "vite-plus/test";
import { CuePlacementError, flatten, totals, type Workout, workoutSchema } from "../src/index";

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
    expect(workoutSchema.parse(swim)).toEqual(swim);
  });

  test.each<[string, unknown]>([
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
  ])("rejects %s", (_, workout) => {
    expect(workoutSchema.safeParse(workout).success).toBe(false);
  });
});

describe("flatten", () => {
  test("expands nested repeats in order", () => {
    const hard = { ...easy, duration: { type: "time", seconds: 30 } } as const;
    expect(
      flatten([
        easy,
        { type: "repeat", count: 2, steps: [hard, { type: "repeat", count: 2, steps: [easy] }] },
      ]),
    ).toEqual([easy, hard, easy, easy, hard, easy, easy]);
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
    expect(steps.map((step) => step.cues)).toEqual([
      [{ at: { type: "time", seconds: 5 }, text: "Go" }],
      [{ at: { type: "time", seconds: 5 }, text: "Go" }],
      [
        { at: { type: "time", seconds: 0 }, text: "Last one" },
        { at: { type: "time", seconds: 5 }, text: "Go" },
        { at: { type: "time", seconds: 60 }, text: "Done" },
      ],
    ]);
  });

  test("refuses a repeat cue it cannot place", () => {
    expect(() =>
      flatten([
        {
          type: "repeat",
          count: 2,
          cues: [{ at: { type: "time", seconds: 500 }, text: "Too late" }],
          steps: [easy],
        },
      ]),
    ).toThrow(CuePlacementError);
    expect(() =>
      flatten([
        {
          type: "repeat",
          count: 2,
          cues: [{ at: { type: "time", seconds: 10 }, text: "By time" }],
          steps: [{ type: "step", duration: { type: "distance", meters: 400 } }],
        },
      ]),
    ).toThrow(CuePlacementError);
  });
});

test("totals add up time and distance through repeats", () => {
  expect(
    totals([
      easy,
      {
        type: "repeat",
        count: 4,
        steps: [easy, { type: "step", duration: { type: "distance", meters: 400 } }],
      },
    ]),
  ).toEqual({ seconds: 300, meters: 1600 });
});
