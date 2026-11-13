import { describe, expect, test } from "vite-plus/test";
import {
  flatten,
  parseZwo,
  type Workout,
  WorkoutFormatError,
  workoutSchema,
  writeZwo,
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

const ftp = (value: number) =>
  ({ type: "power", unit: "ftp", level: { kind: "constant", value } }) as const;

describe("parseZwo", () => {
  test("reads ramps, ranges, repeats, free ride, max efforts, cadence and text events", () => {
    const { value, warnings } = parseZwo(fixture("threshold-builder.zwo"));
    expect(warnings).toEqual([]);
    expect(value).toEqual({
      name: "Threshold builder & sprints",
      sport: "cycling",
      author: "TrainStack Coaching",
      description:
        "Ramp in, three threshold intervals,\nthen sprints. Keep cadence above 90 in the efforts.",
      tags: ["FTP", "Intervals"],
      steps: [
        {
          type: "step",
          duration: { type: "time", seconds: 600 },
          target: { type: "power", unit: "ftp", level: { kind: "ramp", from: 0.4, to: 0.75 } },
          intensity: "warmUp",
          cues: [
            { at: { type: "time", seconds: 0 }, text: "Welcome! Ease into it." },
            {
              at: { type: "time", seconds: 540 },
              text: "Threshold coming up",
              shownForSeconds: 10,
            },
          ],
        },
        {
          type: "step",
          duration: { type: "time", seconds: 120 },
          target: ftp(0.6),
          cadence: { kind: "constant", value: 85 },
        },
        {
          type: "repeat",
          count: 3,
          steps: [
            {
              type: "step",
              duration: { type: "time", seconds: 480 },
              target: ftp(0.98),
              cadence: { kind: "constant", value: 95 },
            },
            {
              type: "step",
              duration: { type: "time", seconds: 240 },
              target: ftp(0.55),
              cadence: { kind: "constant", value: 85 },
            },
          ],
          cues: [
            { at: { type: "time", seconds: 0 }, text: "First of three. Settle in." },
            { at: { type: "time", seconds: 1440 }, text: "Last one, finish strong" },
          ],
        },
        {
          type: "step",
          duration: { type: "time", seconds: 300 },
          target: { type: "power", unit: "ftp", level: { kind: "range", low: 0.88, high: 0.93 } },
          cadence: { kind: "range", low: 90, high: 100 },
        },
        {
          type: "step",
          duration: { type: "time", seconds: 180 },
          target: { type: "power", unit: "ftp", level: { kind: "ramp", from: 0.5, to: 0.9 } },
        },
        {
          type: "step",
          duration: { type: "time", seconds: 300 },
          cadence: { kind: "constant", value: 80 },
          cues: [
            {
              at: { type: "time", seconds: 10 },
              text: 'Free ride: spin easy "however you like"',
            },
          ],
        },
        { type: "step", duration: { type: "time", seconds: 15 }, target: { type: "maxEffort" } },
        { type: "step", duration: { type: "time", seconds: 45 }, target: ftp(0.5) },
        { type: "step", duration: { type: "time", seconds: 15 }, target: { type: "maxEffort" } },
        {
          type: "step",
          duration: { type: "time", seconds: 420 },
          target: { type: "power", unit: "ftp", level: { kind: "ramp", from: 0.7, to: 0.35 } },
          intensity: "coolDown",
        },
      ],
    } satisfies Workout);
  });

  test("places a repeat's text events once, in the iteration they fall in", () => {
    const { value } = parseZwo(fixture("threshold-builder.zwo"));
    const steps = flatten(value.steps);
    const intervals = steps.slice(2, 8);
    expect(intervals.map((step) => step.cues?.map((cue) => cue.text))).toEqual([
      ["First of three. Settle in."],
      undefined,
      undefined,
      undefined,
      ["Last one, finish strong"],
      undefined,
    ]);
  });

  test("reads a distance-based run as pace targets in metres, and reports Zwift's reference pace", () => {
    const { value, warnings } = parseZwo(fixture("tempo-run.zwo"));
    expect(warnings).toEqual([]);
    expect(value.sport).toBe("running");
    expect(value.steps[1]).toEqual({
      type: "repeat",
      count: 3,
      steps: [
        {
          type: "step",
          duration: { type: "distance", meters: 1000 },
          target: { type: "pace", unit: "threshold", level: { kind: "constant", value: 1.02 } },
          cadence: { kind: "constant", value: 180 },
        },
        {
          type: "step",
          duration: { type: "distance", meters: 400 },
          target: { type: "pace", unit: "threshold", level: { kind: "constant", value: 0.75 } },
        },
      ],
    });
    const paced = parseZwo(
      `<workout_file><name>Run</name><sportType>run</sportType><workout><SteadyState Duration="600" Power="0.9" pace="2"/></workout></workout_file>`,
    );
    expect(paced.warnings).toEqual([
      {
        code: "dropped",
        message: "Zwift reference pace 2 is read as a share of threshold pace",
        at: "<SteadyState> on line 1",
      },
    ]);
  });

  test("reports attributes and elements it does not understand", () => {
    const { warnings } = parseZwo(`<workout_file>
  <name>Odd</name>
  <category>Custom</category>
  <workout>
    <FreeRide Duration="60" FlatRoad="1" show_avg="1"/>
  </workout>
</workout_file>`);
    expect(warnings.map((warning) => warning.message)).toEqual([
      "<category> is not supported",
      "Attribute FlatRoad is not supported",
      "Attribute show_avg is not supported",
    ]);
  });

  test("names an untitled workout after the file, or says it had to invent a name", () => {
    const xml = `<workout_file><workout><SteadyState Duration="60" Power="0.5"/></workout></workout_file>`;
    expect(parseZwo(xml, { name: "openers" }).value.name).toBe("openers");
    const untitled = parseZwo(xml);
    expect(untitled.value.name).toBe("Untitled workout");
    expect(untitled.warnings).toHaveLength(1);
  });

  test.each([
    ["broken XML", "<workout_file><workout>", "Unclosed element <workout>"],
    ["another root", "<plan/>", "Expected <workout_file> but found <plan>"],
    [
      "an unknown step",
      `<workout_file><workout><Climb Duration="60"/></workout></workout_file>`,
      "<Climb> is not a known workout step",
    ],
    [
      "a missing duration",
      `<workout_file><workout><SteadyState Power="0.5"/></workout></workout_file>`,
      "Duration is missing",
    ],
    [
      "a power that is not a number",
      `<workout_file><workout><SteadyState Duration="60" Power="high"/></workout></workout_file>`,
      'Power="high" is not a number',
    ],
    [
      "an unknown sport",
      `<workout_file><sportType>swim</sportType><workout/></workout_file>`,
      'Sport type "swim" is not supported',
    ],
    [
      "an empty workout",
      `<workout_file><workout></workout></workout_file>`,
      "Too small: expected array to have >=1 items",
    ],
  ])("fails on %s", (_, xml, message) => {
    const error = failure(() => parseZwo(xml));
    expect(error.format).toBe("zwo");
    expect(error.issues.map((issue) => issue.message).join("\n")).toContain(message);
  });
});

describe("writeZwo", () => {
  test.each(["threshold-builder.zwo", "tempo-run.zwo"])(
    "round-trips %s without changing the workout",
    (name) => {
      const imported = parseZwo(fixture(name)).value;
      const written = writeZwo(imported);
      expect(written.warnings).toEqual([]);
      expect(parseZwo(written.value).value).toEqual(imported);
      expect(writeZwo(parseZwo(written.value).value).value).toBe(written.value);
    },
  );

  test("writes the readable layout Zwift uses", () => {
    expect(writeZwo(parseZwo(fixture("threshold-builder.zwo")).value).value).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
    <author>TrainStack Coaching</author>
    <name>Threshold builder &amp; sprints</name>
    <description>Ramp in, three threshold intervals,
then sprints. Keep cadence above 90 in the efforts.</description>
    <sportType>bike</sportType>
    <tags>
        <tag name="FTP"/>
        <tag name="Intervals"/>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.4" PowerHigh="0.75">
            <textevent timeoffset="0" message="Welcome! Ease into it."/>
            <textevent timeoffset="540" message="Threshold coming up" duration="10"/>
        </Warmup>
        <SteadyState Duration="120" Power="0.6" Cadence="85"/>
        <IntervalsT Repeat="3" OnDuration="480" OffDuration="240" OnPower="0.98" OffPower="0.55" Cadence="95" CadenceResting="85">
            <textevent timeoffset="0" message="First of three. Settle in."/>
            <textevent timeoffset="1440" message="Last one, finish strong"/>
        </IntervalsT>
        <SteadyState Duration="300" PowerLow="0.88" PowerHigh="0.93" CadenceLow="90" CadenceHigh="100"/>
        <Ramp Duration="180" PowerLow="0.5" PowerHigh="0.9"/>
        <FreeRide Duration="300" Cadence="80">
            <textevent timeoffset="10" message="Free ride: spin easy &quot;however you like&quot;"/>
        </FreeRide>
        <MaxEffort Duration="15"/>
        <SteadyState Duration="45" Power="0.5"/>
        <MaxEffort Duration="15"/>
        <Cooldown Duration="420" PowerLow="0.7" PowerHigh="0.35"/>
    </workout>
</workout_file>
`,
    );
  });

  const base: Workout = {
    name: "Model",
    sport: "cycling",
    steps: [{ type: "step", duration: { type: "time", seconds: 60 }, target: ftp(0.5) }],
  };

  test("writes nested repeats out step by step and keeps their timeline", () => {
    const workout: Workout = {
      ...base,
      steps: [
        {
          type: "repeat",
          count: 2,
          name: "Sets",
          cues: [{ at: { type: "time", seconds: 150 }, text: "Second set" }],
          steps: [
            {
              type: "repeat",
              count: 3,
              steps: [
                {
                  type: "step",
                  duration: { type: "time", seconds: 30 },
                  target: ftp(1.2),
                  cues: [{ at: { type: "time", seconds: 0 }, text: "Go" }],
                },
                { type: "step", duration: { type: "time", seconds: 15 }, target: ftp(0.4) },
              ],
            },
            { type: "step", duration: { type: "time", seconds: 15 }, target: ftp(0.5) },
          ],
        },
      ],
    };
    const written = writeZwo(workout);
    expect(written.warnings.map((warning) => warning.code)).toEqual(["expanded", "dropped"]);
    expect(flatten(parseZwo(written.value).value.steps)).toEqual(flatten(workout.steps));
  });

  test("turns watts into shares of FTP when given an FTP", () => {
    const workout: Workout = {
      ...base,
      steps: [
        {
          type: "step",
          duration: { type: "time", seconds: 60 },
          target: { type: "power", unit: "watts", level: { kind: "constant", value: 200 } },
        },
      ],
    };
    expect(failure(() => writeZwo(workout)).issues[0]?.message).toBe(
      "Power in watts needs an FTP to become a share of FTP",
    );
    expect(parseZwo(writeZwo(workout, { ftp: 250 }).value).value.steps[0]).toEqual({
      type: "step",
      duration: { type: "time", seconds: 60 },
      target: ftp(0.8),
    });
  });

  test("reports what a .zwo file cannot carry", () => {
    const { warnings } = writeZwo({
      ...base,
      focus: "threshold",
      steps: [
        {
          type: "step",
          duration: { type: "time", seconds: 60 },
          target: ftp(0.5),
          intensity: "recovery",
          name: "Spin",
          notes: "Keep it easy",
        },
      ],
    });
    expect(warnings.map((warning) => warning.message)).toEqual([
      'Focus "threshold" has no place in a .zwo file',
      'Name "Spin" has no place in a .zwo file',
      "Notes have no place in a .zwo file",
      'Intensity "recovery" has no place in this step',
    ]);
  });

  test.each<[string, Workout, string]>([
    [
      "heart rate targets",
      {
        ...base,
        steps: [
          {
            type: "step",
            duration: { type: "time", seconds: 60 },
            target: { type: "heartRate", unit: "bpm", level: { kind: "constant", value: 150 } },
          },
        ],
      },
      "Zwift bike workouts cannot hold heartRate targets",
    ],
    [
      "absolute pace",
      {
        ...base,
        sport: "running",
        steps: [
          {
            type: "step",
            duration: { type: "time", seconds: 60 },
            target: {
              type: "pace",
              unit: "metersPerSecond",
              level: { kind: "constant", value: 4 },
            },
          },
        ],
      },
      "Zwift run workouts only hold pace as a share of threshold pace",
    ],
    ["swims", { ...base, sport: "swimming" }, "Zwift workouts cannot hold swims"],
    [
      "time and distance steps together",
      {
        ...base,
        steps: [
          ...base.steps,
          { type: "step", duration: { type: "distance", meters: 400 }, target: ftp(0.5) },
        ],
      },
      "A .zwo file measures every step in time or every step in distance",
    ],
    [
      "an invalid workout",
      { ...base, steps: [] },
      "The workout is not valid: Too small: expected array to have >=1 items",
    ],
  ])("fails on %s", (_, workout, message) => {
    expect(failure(() => writeZwo(workout)).issues.map((issue) => issue.message)).toContain(
      message,
    );
  });

  test("writes only valid workouts", () => {
    expect(workoutSchema.safeParse(parseZwo(writeZwo(base).value).value).success).toBe(true);
  });
});

test("rejects a file whose repeats would expand past the step limit", () => {
  const error = failure(() =>
    parseZwo(
      `<workout_file><workout><IntervalsT Repeat="1000000000" OnDuration="1" OffDuration="1" OnPower="1" OffPower="0.5"/></workout></workout_file>`,
    ),
  );
  expect(error.issues[0]?.message).toBe("A workout can expand to at most 10000 steps");
});

test.each(["constructor", "toString", "__proto__"])(
  "rejects a step named after the object property %s with a format error",
  (name) => {
    const error = failure(() =>
      parseZwo(`<workout_file><workout><${name} Duration="60"/></workout></workout_file>`),
    );
    expect(error.issues[0]?.message).toBe(`<${name}> is not a known workout step`);
  },
);

test("keeps fractional values exactly through a .zwo round trip", () => {
  const workout: Workout = {
    name: "Fractions",
    sport: "cycling",
    steps: [
      {
        type: "step",
        duration: { type: "time", seconds: 37.25 },
        target: {
          type: "power",
          unit: "ftp",
          level: { kind: "range", low: 0.123456789, high: 0.987654321 },
        },
        cadence: { kind: "constant", value: 92.5 },
        cues: [{ at: { type: "time", seconds: 12.345 }, text: "Precise" }],
      },
    ],
  };
  expect(parseZwo(writeZwo(workout).value).value).toEqual(workout);
});
