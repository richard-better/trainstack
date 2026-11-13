import { describe, expect, test } from "vite-plus/test";
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
} from "../src/index";
import { fixture } from "./fixtures";

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
    expect(warnings).toEqual([
      { code: "dropped", message: "Header FTP = 250 is not kept; targets stay as written" },
    ]);
    expect(value).toEqual({
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
    expect(written.warnings).toEqual([]);
    expect(parseErg(written.value).value).toEqual(imported);
    expect(written.value).toBe(`[COURSE HEADER]
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
`);
  });

  test("writes shares of FTP as watts when given an FTP, and names that FTP", () => {
    const workout: Workout = {
      name: "Openers",
      sport: "cycling",
      steps: [{ type: "step", duration: seconds(40), target: ftp(1.2) }],
    };
    expect(failure(() => writeErg(workout)).issues[0]?.message).toBe(
      "Power as a share of FTP needs an FTP to become watts",
    );
    const written = writeErg(workout, { ftp: 250 }).value;
    expect(written).toContain("FTP = 250\nMINUTES WATTS");
    expect(written).toContain("0\t300\n0.666666666666667\t300\n");
    expect(parseErg(written).value.steps).toEqual([
      { type: "step", duration: seconds(40), target: watts(300) },
    ]);
  });
});

test.each([
  ["erg", parseErg, writeErg],
  ["mrc", parseMrc, writeMrc],
] as const)("keeps fractional values exactly through a .%s round trip", (_, parse, write) => {
  const workout: Workout = {
    name: "Fractions",
    sport: "cycling",
    steps: [
      {
        type: "step",
        duration: seconds(37.25),
        target: {
          type: "power",
          unit: _ === "erg" ? "watts" : "ftp",
          level: {
            kind: "ramp",
            from: _ === "erg" ? 123.456 : 0.123456,
            to: _ === "erg" ? 201.789 : 0.987654,
          },
        },
        cues: [{ at: seconds(12.345), text: "Precise", shownForSeconds: 2.5 }],
      },
    ],
  };
  const written = write(workout);
  expect(written.warnings).toEqual([]);
  expect(parse(written.value).value).toEqual(workout);
});

describe("parseMrc", () => {
  test("reads percent of FTP and Windows line endings", () => {
    const { value, warnings } = parseMrc(fixture("over-unders.mrc"));
    expect(warnings).toEqual([]);
    expect(value.name).toBe("Over-unders 3x9");
    const steps = value.steps as Step[];
    expect(steps).toHaveLength(11);
    expect(steps[0]).toEqual({
      type: "step",
      duration: seconds(480),
      target: { type: "power", unit: "ftp", level: { kind: "ramp", from: 0.45, to: 0.75 } },
    });
    expect(steps[1]).toEqual({
      type: "step",
      duration: seconds(120),
      target: ftp(0.95),
      cues: [{ at: seconds(0), text: "Over-unders start: 95 then 105" }],
    });
    expect(steps[5]?.cues).toEqual([{ at: seconds(0), text: "Recover" }]);
    expect(steps[10]).toEqual({
      type: "step",
      duration: seconds(360),
      target: { type: "power", unit: "ftp", level: { kind: "ramp", from: 0.75, to: 0.45 } },
    });
  });

  test("round-trips without changing the workout", () => {
    const imported = parseMrc(fixture("over-unders.mrc")).value;
    const written = writeMrc(imported);
    expect(written.warnings).toEqual([]);
    expect(parseMrc(written.value).value).toEqual(imported);
    expect(writeMrc(parseMrc(written.value).value).value).toBe(written.value);
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
    expect(written.warnings.map((warning) => warning.message)).toEqual([
      'Focus "vo2Max" has no place in a .mrc file',
      "Repeats are written out step by step in a .mrc file",
      'Name "Pyramid" has no place in this format',
      "Cadence has no place in this format",
      'Intensity "recovery" has no place in this format',
      "Cadence has no place in this format",
      'Intensity "recovery" has no place in this format',
    ]);
    const stripped = flatten(workout.steps).map((step) => {
      const copy = { ...step };
      delete copy.cadence;
      delete copy.intensity;
      return copy;
    });
    expect(parseMrc(written.value).value.steps).toEqual(stripped);
  });

  test.each<[string, Step, string]>([
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
  ])("fails on %s", (_, step, message) => {
    const error = failure(() =>
      writeMrc({ name: "Odd", sport: "cycling", steps: [step] }, { ftp: 250 }),
    );
    expect(error.format).toBe("mrc");
    expect(error.issues).toEqual([{ code: "unsupported", message, at: "step 1" }]);
  });

  test.each([
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
  ])("fails to read %s", (_, text, message) => {
    const error = failure(() => parseErg(text));
    expect(error.issues.map((issue) => issue.message)).toContain(message);
  });
});

describe("parseWorkoutFile", () => {
  test("picks the format from the extension and names the workout after the file", () => {
    const text =
      "[COURSE HEADER]\nMINUTES PERCENT\n[END COURSE HEADER]\n[COURSE DATA]\n0 50\n1 50\n[END COURSE DATA]\n";
    const { value } = parseWorkoutFile("downloads/Easy spin.MRC", text);
    expect(value.name).toBe("Easy spin");
    expect(value.steps).toEqual([{ type: "step", duration: seconds(60), target: ftp(0.5) }]);
    expect(failure(() => parseWorkoutFile("ride.fit", "")).format).toBeUndefined();
  });
});
