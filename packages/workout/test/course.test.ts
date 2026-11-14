import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  flatten,
  parseErg,
  parseMrc,
  parseWorkoutFile,
  type Step,
  type Workout,
  WorkoutFormatError,
  writeErg,
  writeMrc,
} from "../src/index.ts";
import { fixture } from "./fixtures.ts";

function failure(run: () => unknown): WorkoutFormatError {
  try {
    run();
  } catch (error) {
    if (error instanceof WorkoutFormatError) return error;
    throw error;
  }
  throw new Error("Expected a WorkoutFormatError");
}

const watts = (value: number) =>
  ({ type: "power", unit: "watts", level: { kind: "constant", value } }) as const;
const ftp = (value: number) =>
  ({ type: "power", unit: "ftp", level: { kind: "constant", value } }) as const;
const seconds = (value: number) => ({ type: "time", seconds: value }) as const;

describe("parseErg", () => {
  test("reads watts, ramps, jumps and course text", () => {
    const { value, warnings } = parseErg(fixture("sweet-spot.erg"));
    assert.deepEqual(warnings, [
      { code: "dropped", message: "Header FTP = 250 is not kept; targets stay as written" },
    ]);
    assert.deepEqual(value, {
      name: "Sweet spot 2x15",
      sport: "cycling",
      description: "Two sweet spot blocks with a ramped warm-up",
      steps: [
        {
          type: "step",
          duration: seconds(600),
          target: { type: "power", unit: "watts", level: { kind: "ramp", from: 100, to: 180 } },
          cues: [{ at: seconds(0), text: "Warm up gradually", shownForSeconds: 15 }],
        },
        {
          type: "step",
          duration: seconds(900),
          target: watts(225),
          cues: [{ at: seconds(0), text: "First sweet spot block", shownForSeconds: 10 }],
        },
        { type: "step", duration: seconds(300), target: watts(125) },
        {
          type: "step",
          duration: seconds(900),
          target: watts(225),
          cues: [{ at: seconds(0), text: "Second block, same again" }],
        },
        { type: "step", duration: seconds(300), target: watts(100) },
      ],
    } satisfies Workout);
  });

  test("round-trips without changing the workout", () => {
    const imported = parseErg(fixture("sweet-spot.erg")).value;
    const written = writeErg(imported);
    assert.deepEqual(written.warnings, []);
    assert.deepEqual(parseErg(written.value).value, imported);
    assert.equal(
      written.value,
      `[COURSE HEADER]
VERSION = 2
UNITS = ENGLISH
DESCRIPTION = Two sweet spot blocks with a ramped warm-up
FILE NAME = Sweet spot 2x15
MINUTES WATTS
[END COURSE HEADER]
[COURSE DATA]
0\t100
10\t180
10\t225
25\t225
25\t125
30\t125
30\t225
45\t225
45\t100
50\t100
[END COURSE DATA]
[COURSE TEXT]
0\tWarm up gradually\t15
600\tFirst sweet spot block\t10
1800\tSecond block, same again
[END COURSE TEXT]
`,
    );
  });

  test("writes shares of FTP as watts when given an FTP, and names that FTP", () => {
    const workout: Workout = {
      name: "Openers",
      sport: "cycling",
      steps: [{ type: "step", duration: seconds(40), target: ftp(1.2) }],
    };
    assert.equal(
      failure(() => writeErg(workout)).issues[0]?.message,
      "Power as a share of FTP needs an FTP to become watts",
    );
    const written = writeErg(workout, { ftp: 250 }).value;
    assert.ok(written.includes("FTP = 250\nMINUTES WATTS"));
    assert.ok(written.includes("0\t300\n0.666666666666667\t300\n"));
    assert.deepEqual(parseErg(written).value.steps, [
      { type: "step", duration: seconds(40), target: watts(300) },
    ]);
  });
});

for (const [label, parse, write] of [
  ["erg", parseErg, writeErg],
  ["mrc", parseMrc, writeMrc],
] as const) {
  test(`keeps fractional values exactly through a .${String(label)} round trip`, () => {
    const workout: Workout = {
      name: "Fractions",
      sport: "cycling",
      steps: [
        {
          type: "step",
          duration: seconds(37.25),
          target: {
            type: "power",
            unit: label === "erg" ? "watts" : "ftp",
            level: {
              kind: "ramp",
              from: label === "erg" ? 123.456 : 0.123456,
              to: label === "erg" ? 201.789 : 0.987654,
            },
          },
          cues: [{ at: seconds(12.345), text: "Precise", shownForSeconds: 2.5 }],
        },
      ],
    };
    const written = write(workout);
    assert.deepEqual(written.warnings, []);
    assert.deepEqual(parse(written.value).value, workout);
  });
}

describe("parseMrc", () => {
  test("reads percent of FTP and Windows line endings", () => {
    const { value, warnings } = parseMrc(fixture("over-unders.mrc"));
    assert.deepEqual(warnings, []);
    assert.equal(value.name, "Over-unders 3x9");
    const steps = value.steps as Step[];
    assert.equal(steps.length, 11);
    assert.deepEqual(steps[0], {
      type: "step",
      duration: seconds(480),
      target: { type: "power", unit: "ftp", level: { kind: "ramp", from: 0.45, to: 0.75 } },
    });
    assert.deepEqual(steps[1], {
      type: "step",
      duration: seconds(120),
      target: ftp(0.95),
      cues: [{ at: seconds(0), text: "Over-unders start: 95 then 105" }],
    });
    assert.deepEqual(steps[5]?.cues, [{ at: seconds(0), text: "Recover" }]);
    assert.deepEqual(steps[10], {
      type: "step",
      duration: seconds(360),
      target: { type: "power", unit: "ftp", level: { kind: "ramp", from: 0.75, to: 0.45 } },
    });
  });

  test("round-trips without changing the workout", () => {
    const imported = parseMrc(fixture("over-unders.mrc")).value;
    const written = writeMrc(imported);
    assert.deepEqual(written.warnings, []);
    assert.deepEqual(parseMrc(written.value).value, imported);
    assert.equal(writeMrc(parseMrc(written.value).value).value, written.value);
  });
});

describe("writing course files", () => {
  const workout: Workout = {
    name: "Pyramid",
    sport: "cycling",
    focus: "vo2Max",
    steps: [
      {
        type: "repeat",
        count: 2,
        name: "Pyramid",
        steps: [
          {
            type: "step",
            duration: seconds(30),
            target: ftp(1.1),
            cadence: { kind: "constant", value: 100 },
            cues: [{ at: seconds(5), text: "Push" }],
          },
          { type: "step", duration: seconds(30), target: ftp(0.5), intensity: "recovery" },
        ],
      },
    ],
  };

  test("writes repeats out and keeps the timeline, reporting what it leaves out", () => {
    const written = writeMrc(workout);
    assert.deepEqual(
      written.warnings.map((warning) => warning.message),
      [
        'Focus "vo2Max" has no place in a .mrc file',
        "Repeats are written out step by step in a .mrc file",
        'Name "Pyramid" has no place in this format',
        "Cadence has no place in this format",
        'Intensity "recovery" has no place in this format',
        "Cadence has no place in this format",
        'Intensity "recovery" has no place in this format',
      ],
    );
    const stripped = flatten(workout.steps).map((step) => {
      const copy = { ...step };
      delete copy.cadence;
      delete copy.intensity;
      return copy;
    });
    assert.deepEqual(parseMrc(written.value).value.steps, stripped);
  });

  for (const [label, step, message] of [
    [
      "distance steps",
      { type: "step", duration: { type: "distance", meters: 400 }, target: ftp(1) },
      "Steps measured in distance have no place in this format",
    ],
    [
      "power ranges",
      {
        type: "step",
        duration: seconds(60),
        target: { type: "power", unit: "ftp", level: { kind: "range", low: 0.9, high: 0.95 } },
      },
      "A power range has no place in this format",
    ],
    [
      "heart rate targets",
      {
        type: "step",
        duration: seconds(60),
        target: { type: "heartRate", unit: "threshold", level: { kind: "constant", value: 0.8 } },
      },
      "A heartRate target has no place in this format",
    ],
    [
      "free ride",
      { type: "step", duration: seconds(60) },
      "A step without a target has no place in this format",
    ],
    [
      "max efforts",
      { type: "step", duration: seconds(60), target: { type: "maxEffort" } },
      "A maxEffort target has no place in this format",
    ],
  ] as [string, Step, string][]) {
    test(`fails on ${String(label)}`, () => {
      const error = failure(() =>
        writeMrc({ name: "Odd", sport: "cycling", steps: [step] }, { ftp: 250 }),
      );
      assert.equal(error.format, "mrc");
      assert.deepEqual(error.issues, [{ code: "unsupported", message, at: "step 1" }]);
    });
  }

  for (const [label, text, message] of [
    [
      "no data section",
      "[COURSE HEADER]\nMINUTES WATTS\n[END COURSE HEADER]\n",
      "The file has no [COURSE DATA]",
    ],
    [
      "unknown columns",
      "[COURSE HEADER]\nMILES GRADE\n[END COURSE HEADER]\n[COURSE DATA]\n0 1\n[END COURSE DATA]\n",
      'Columns "MILES GRADE" are not supported',
    ],
    [
      "time going backwards",
      "[COURSE HEADER]\nMINUTES WATTS\n[END COURSE HEADER]\n[COURSE DATA]\n0 100\n5 100\n4 100\n[END COURSE DATA]\n",
      "Points must not go back in time",
    ],
    ["an unclosed section", "[COURSE HEADER]\nMINUTES WATTS\n", "[COURSE HEADER] is never closed"],
    [
      "text outside the workout",
      "[COURSE HEADER]\nMINUTES WATTS\n[END COURSE HEADER]\n[COURSE DATA]\n0 100\n1 100\n[END COURSE DATA]\n[COURSE TEXT]\n90\tToo late\n[END COURSE TEXT]\n",
      "Course text at 90 seconds is outside the workout",
    ],
  ] as [string, string, string][]) {
    test(`fails to read ${String(label)}`, () => {
      const error = failure(() => parseErg(text));
      assert.ok(error.issues.map((issue) => issue.message).includes(message));
    });
  }
});

describe("lap-button steps in course files", () => {
  const lapped: Workout = {
    name: "Lapped",
    sport: "cycling",
    steps: [
      {
        type: "step",
        duration: { type: "open", expected: { type: "time", seconds: 600 } },
        target: ftp(0.5),
      },
      { type: "step", duration: seconds(300), target: ftp(1) },
    ],
  };

  for (const [format, write] of [
    ["erg", writeErg],
    ["mrc", writeMrc],
  ] as const) {
    test(`a .${format} file cannot hold a lap-button step, so writing one fails`, () => {
      assert.deepEqual(failure(() => write(lapped, { ftp: 200 })).issues, [
        {
          code: "unsupported",
          message: `A lap-button step has no place in a .${format} file`,
          at: "steps.0",
        },
      ]);
    });

    test(`approximate writes a lap-button step to .${format} as a step of its expected length`, () => {
      const { value, warnings } = write(lapped, { ftp: 200, approximate: true });
      assert.deepEqual(warnings, [
        {
          code: "approximated",
          message: "The lap-button step is written as a step of its expected length, 600 s",
          at: "steps.0",
        },
      ]);
      const read = format === "erg" ? parseErg(value) : parseMrc(value);
      assert.deepEqual(
        flatten(read.value.steps).map((step) => step.duration),
        [seconds(600), seconds(300)],
      );
    });
  }

  test("approximate still fails for a lap-button step with no expected length", () => {
    const unknown: Workout = {
      ...lapped,
      steps: [{ type: "step", duration: { type: "open" }, target: ftp(0.5) }],
    };
    assert.deepEqual(
      failure(() => writeMrc(unknown, { approximate: true })).issues.map((issue) => issue.message),
      ["A lap-button step with no expected length cannot be written as a timed step"],
    );
  });
});

describe("parseWorkoutFile", () => {
  test("picks the format from the extension and names the workout after the file", () => {
    const text =
      "[COURSE HEADER]\nMINUTES PERCENT\n[END COURSE HEADER]\n[COURSE DATA]\n0 50\n1 50\n[END COURSE DATA]\n";
    const { value } = parseWorkoutFile("downloads/Easy spin.MRC", text);
    assert.equal(value.name, "Easy spin");
    assert.deepEqual(value.steps, [{ type: "step", duration: seconds(60), target: ftp(0.5) }]);
    assert.equal(failure(() => parseWorkoutFile("ride.gpx", "")).format, undefined);
  });
});
