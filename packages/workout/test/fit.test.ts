import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { decodeFitWorkout, encodeFitWorkout, type FitWorkout } from "@trainstack/fit";

import {
  type Block,
  flatten,
  parseFit,
  parseWorkoutFile,
  type Workout,
  WorkoutFormatError,
  writeFit,
} from "../src/index.ts";

function reference(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(new URL(`../../fit/test/fixtures/workouts/${name}`, import.meta.url)),
  );
}

function failure(run: () => unknown): WorkoutFormatError {
  try {
    run();
  } catch (error) {
    if (error instanceof WorkoutFormatError) return error;
    throw error;
  }
  assert.fail("expected a WorkoutFormatError");
}

function messages(error: WorkoutFormatError): string[] {
  return error.issues.map((issue) => `${issue.code} ${issue.at ?? "-"}: ${issue.message}`);
}

const powerStep = (seconds: number, value: number): Block => ({
  type: "step",
  duration: { type: "time", seconds },
  target: { type: "power", unit: "ftp", level: { kind: "constant", value } },
});

describe("parseFit on files written by other tools", () => {
  test("TrainingPeaks: percent-of-FTP ranges, step names, notes and a repeat", () => {
    const { value, warnings } = parseFit(reference("trainingpeaks-bike.fit"));
    assert.deepEqual(warnings, []);
    assert.deepEqual(value, {
      name: "Over-unders 3 x 9",
      sport: "cycling",
      steps: [
        {
          type: "step",
          duration: { type: "time", seconds: 900 },
          target: { type: "power", unit: "ftp", level: { kind: "range", low: 0.5, high: 0.65 } },
          intensity: "warmUp",
          name: "Warm up",
        },
        {
          type: "repeat",
          count: 3,
          name: "Over-unders",
          steps: [
            {
              type: "step",
              duration: { type: "time", seconds: 120 },
              target: {
                type: "power",
                unit: "ftp",
                level: { kind: "range", low: 0.88, high: 0.92 },
              },
              intensity: "active",
              name: "Under",
            },
            {
              type: "step",
              duration: { type: "time", seconds: 60 },
              target: {
                type: "power",
                unit: "ftp",
                level: { kind: "range", low: 1.03, high: 1.07 },
              },
              intensity: "active",
              name: "Over",
              notes: "Stay seated",
            },
          ],
        },
        {
          type: "step",
          duration: { type: "time", seconds: 300 },
          target: { type: "power", unit: "ftp", level: { kind: "constant", value: 0.5 } },
          intensity: "rest",
          name: "Recover",
        },
        {
          type: "step",
          duration: { type: "time", seconds: 600 },
          target: { type: "power", unit: "ftp", level: { kind: "range", low: 0.4, high: 0.55 } },
          intensity: "coolDown",
          name: "Cool down",
        },
      ],
    });
  });

  test("intervals.icu: nested repeats, watts, cadence and a distance step", () => {
    const { value } = parseFit(reference("intervals-icu-nested.fit"));
    const [warmUp, sets, coolDown] = value.steps;
    assert.equal(warmUp?.type, "step");
    assert.equal(coolDown?.type === "step" && coolDown.duration.type, "distance");
    assert.deepEqual(sets, {
      type: "repeat",
      count: 3,
      steps: [
        {
          type: "repeat",
          count: 10,
          steps: [
            {
              type: "step",
              duration: { type: "time", seconds: 15 },
              target: {
                type: "power",
                unit: "watts",
                level: { kind: "range", low: 400, high: 420 },
              },
              cadence: { kind: "range", low: 100, high: 110 },
              intensity: "active",
              name: "On",
            },
            {
              type: "step",
              duration: { type: "time", seconds: 15 },
              target: { type: "power", unit: "watts", level: { kind: "constant", value: 150 } },
              intensity: "recovery",
              name: "Off",
            },
          ],
        },
        {
          type: "step",
          duration: { type: "time", seconds: 300 },
          target: { type: "power", unit: "ftp", level: { kind: "constant", value: 0.5 } },
          intensity: "rest",
          name: "Between sets",
        },
      ],
    });
  });

  test("Garmin Connect: a heart rate zone needs the athlete's zones, and says which setting", () => {
    const error = failure(() => parseFit(reference("garmin-connect-run-intervals.fit")));
    assert.deepEqual(messages(error), [
      "unsupported step 1: Heart rate zone 2 refers to zones of the athlete's own; set heart rate zones to import it",
    ]);
  });

  test("Garmin Connect: a heart rate zone becomes the athlete's zone range, with a warning naming the zones", () => {
    const { value, warnings } = parseFit(reference("garmin-connect-run-intervals.fit"), {
      zones: {
        heartRate: [
          { low: null, high: 120 },
          { low: 121, high: 140 },
          { low: 141, high: 155 },
          { low: 156, high: 170 },
          { low: 171, high: null },
        ],
        source: "the athlete's zones on 2026-11-14",
      },
    });
    assert.deepEqual(warnings, [
      {
        code: "converted",
        message: "Heart rate zone 2 became 121-140 bpm from the athlete's zones on 2026-11-14",
        at: "step 1",
      },
    ]);
    assert.deepEqual(value.steps[0], {
      type: "step",
      duration: { type: "time", seconds: 600 },
      target: { type: "heartRate", unit: "bpm", level: { kind: "range", low: 121, high: 140 } },
      intensity: "warmUp",
    });
    assert.deepEqual(value.steps[1], {
      type: "repeat",
      count: 5,
      steps: [
        {
          type: "step",
          duration: { type: "distance", meters: 1000 },
          target: {
            type: "pace",
            unit: "metersPerSecond",
            level: { kind: "range", low: 3.846, high: 4.167 },
          },
          intensity: "active",
          notes: "Controlled, even splits",
        },
        { type: "step", duration: { type: "time", seconds: 120 }, intensity: "recovery" },
      ],
    });
  });

  test("a zone the athlete's zones do not reach, or one with no upper limit, is refused", () => {
    const options = {
      zones: {
        heartRate: [
          { low: null, high: 130 },
          { low: 131, high: null },
        ],
      },
    };
    assert.deepEqual(
      messages(
        failure(() =>
          parseFit(reference("garmin-connect-run-intervals.fit"), {
            zones: { heartRate: [{ low: null, high: 130 }] },
          }),
        ),
      ),
      ["unsupported step 1: Heart rate zone 2 is not one of the 1 heart rate zones given"],
    );
    assert.deepEqual(
      messages(failure(() => parseFit(reference("garmin-connect-run-intervals.fit"), options))),
      ["unsupported step 1: Heart rate zone 2 has no upper limit, so it cannot become a range"],
    );
  });

  test("Garmin Connect: a lap-button step is refused by name, as TrainStack has no lap-button steps yet", () => {
    const error = failure(() => parseFit(reference("garmin-connect-lap-button.fit")));
    assert.deepEqual(messages(error), [
      "unsupported step 1: Step 1 lasts until the lap button is pressed, and TrainStack does not support lap-button steps yet",
      "unsupported step 2: The target is 80-87% of max heart rate; set a max heart rate to import it",
      "unsupported step 3: Step 3 lasts until the lap button is pressed, and TrainStack does not support lap-button steps yet",
    ]);
  });

  test("percent of max heart rate becomes bpm from the athlete's max heart rate", () => {
    const { value, warnings } = parseFit(reference("trainingpeaks-run-heart-rate.fit"), {
      maxHeartRate: 190,
    });
    assert.deepEqual(warnings, [
      {
        code: "converted",
        message: "60-70% of max heart rate became 114-133 bpm from a max heart rate of 190 bpm",
        at: "step 1",
      },
    ]);
    assert.deepEqual(
      value.steps.map((block) => block.type === "step" && block.target),
      [
        { type: "heartRate", unit: "bpm", level: { kind: "range", low: 114, high: 133 } },
        { type: "heartRate", unit: "bpm", level: { kind: "range", low: 138, high: 148 } },
      ],
    );
  });

  test("Garmin Connect: a step until heart rate drops is refused, saying what it waits for", () => {
    const error = failure(() => parseFit(reference("garmin-connect-hr-recovery.fit")));
    assert.deepEqual(messages(error), [
      "unsupported step 2: Step 2 lasts until heart rate drops below a value, and TrainStack steps last a time or a distance",
    ]);
  });

  test("Garmin Connect: watts past the 1000 offset, a power zone from the athlete's zones, and cadence", () => {
    const { value, warnings } = parseFit(reference("garmin-connect-bike-watts.fit"), {
      zones: {
        power: [
          { low: null, high: 137 },
          { low: 138, high: 187 },
        ],
      },
    });
    assert.deepEqual(
      warnings.map((warning) => warning.message),
      ['Sub sport "indoorCycling" is not kept', "Power zone 2 became 138-187 W"],
    );
    assert.deepEqual(value.steps[1], {
      type: "repeat",
      count: 3,
      steps: [
        {
          type: "step",
          duration: { type: "time", seconds: 720 },
          target: { type: "power", unit: "watts", level: { kind: "range", low: 230, high: 245 } },
          cadence: { kind: "range", low: 85, high: 95 },
          intensity: "active",
        },
        {
          type: "step",
          duration: { type: "time", seconds: 240 },
          target: { type: "power", unit: "watts", level: { kind: "range", low: 120, high: 150 } },
          intensity: "recovery",
        },
      ],
    });
  });

  test("Garmin Connect: a pool swim by distance keeps its speeds and drops strokes and equipment", () => {
    const { value, warnings } = parseFit(reference("garmin-connect-pool-swim.fit"));
    assert.deepEqual(
      warnings.map((warning) => `${warning.code} ${warning.at ?? "-"}: ${warning.message}`),
      [
        'dropped -: Sub sport "lapSwimming" is not kept',
        "dropped -: Pool length 25 m is not kept",
        "dropped step 1: The freestyle stroke is not kept",
        "dropped step 2: The freestyle stroke is not kept",
        'dropped step 2: Equipment "swimPullBuoy" is not kept',
        "dropped step 5: The backstroke stroke is not kept",
      ],
    );
    assert.equal(value.sport, "swimming");
    assert.deepEqual(flatten(value.steps).length, 1 + 8 * 2 + 1);
    assert.deepEqual(value.steps[1], {
      type: "repeat",
      count: 8,
      steps: [
        {
          type: "step",
          duration: { type: "distance", meters: 100 },
          target: {
            type: "pace",
            unit: "metersPerSecond",
            level: { kind: "range", low: 1.176, high: 1.25 },
          },
          intensity: "active",
        },
        { type: "step", duration: { type: "time", seconds: 20 }, intensity: "rest" },
      ],
    });
  });
});

describe("parseFit on files it cannot take", () => {
  test("a FIT activity is told apart from a workout", () => {
    const activity = new Uint8Array(
      readFileSync(
        new URL(
          "../../../apps/ride/RideKit/Sources/RideData/Resources/SampleRide.fit",
          import.meta.url,
        ),
      ),
    );
    assert.deepEqual(messages(failure(() => parseFit(activity))), [
      "unsupported -: The file is a FIT activity, a record of a session done, not a workout",
    ]);
  });

  test("bytes that are not FIT fail as malformed", () => {
    const error = failure(() => parseFit(new TextEncoder().encode("<workout_file/>")));
    assert.equal(error.format, "fit");
    assert.deepEqual(messages(error), ["malformed -: The data is not a FIT file."]);
  });

  test("a sport TrainStack does not plan for is refused", () => {
    const bytes = encodeFitWorkout({
      name: "Row",
      sport: "rowing",
      steps: [{ duration: { type: "time", seconds: 60 } }],
    });
    assert.deepEqual(messages(failure(() => parseFit(bytes))), [
      'unsupported -: Sport "rowing" is not one TrainStack plans workouts for: cycling, running or swimming',
    ]);
  });

  test("repeats that go forward, cross another repeat, or run zero times are malformed", () => {
    const step = { duration: { type: "time", seconds: 60 } } as const;
    const crossing: FitWorkout = {
      name: "Crossing",
      sport: "cycling",
      steps: [
        step,
        step,
        { duration: { type: "repeat", fromStep: 0, count: 2 } },
        step,
        { duration: { type: "repeat", fromStep: 1, count: 2 } },
        { duration: { type: "repeat", fromStep: 6, count: 2 } },
        { duration: { type: "repeat", fromStep: 3, count: 0 } },
      ],
    };
    assert.deepEqual(messages(failure(() => parseFit(encodeFitWorkout(crossing)))), [
      "malformed step 5: The repeat goes back to step 2, which does not start a run of steps it can repeat",
      "malformed step 6: The repeat goes forward to step 7",
      "malformed step 7: The repeat runs 0 times",
    ]);
  });

  test("repeats that multiply past the model's limit fail fast", () => {
    const steps: FitWorkout["steps"][number][] = [{ duration: { type: "time", seconds: 1 } }];
    for (let index = 0; index < 20; index++) {
      steps.push({ duration: { type: "repeat", fromStep: 0, count: 0xfffffffe } });
    }
    const started = performance.now();
    const error = failure(() =>
      parseFit(encodeFitWorkout({ name: "Huge", sport: "cycling", steps })),
    );
    assert.ok(performance.now() - started < 1000);
    assert.deepEqual(messages(error), [
      "malformed steps: A workout can expand to at most 10000 steps",
    ]);
  });

  test("random corruption of a written file only ever fails with a WorkoutFormatError", () => {
    const source = writeFit(sample, { approximate: true }).value;
    let state = 7;
    const next = (below: number) => {
      state = (state * 1103515245 + 12345) % 2 ** 31;
      return state % below;
    };
    for (let round = 0; round < 1_000; round++) {
      const bytes = source.slice();
      for (let flip = 0; flip < 1 + next(4); flip++)
        bytes[14 + next(bytes.length - 16)] = next(256);
      try {
        parseFit(bytes);
      } catch (error) {
        assert.ok(error instanceof WorkoutFormatError, String(error));
      }
    }
  });
});

const sample: Workout = {
  name: "Everything FIT can say",
  sport: "cycling",
  steps: [
    {
      type: "step",
      duration: { type: "time", seconds: 600 },
      target: { type: "power", unit: "ftp", level: { kind: "range", low: 0.5, high: 0.65 } },
      intensity: "warmUp",
      name: "Warm up",
      notes: "Spin easy",
    },
    {
      type: "repeat",
      count: 4,
      name: "Main set",
      steps: [
        {
          type: "step",
          duration: { type: "time", seconds: 240 },
          target: { type: "power", unit: "watts", level: { kind: "constant", value: 300 } },
          cadence: { kind: "range", low: 90, high: 100 },
          intensity: "active",
        },
        {
          type: "step",
          duration: { type: "distance", meters: 1500 },
          target: { type: "heartRate", unit: "bpm", level: { kind: "range", low: 120, high: 130 } },
          intensity: "recovery",
        },
      ],
    },
    {
      type: "step",
      duration: { type: "time", seconds: 300 },
      target: {
        type: "pace",
        unit: "metersPerSecond",
        level: { kind: "range", low: 3.5, high: 4 },
      },
      intensity: "rest",
    },
    {
      type: "step",
      duration: { type: "time", seconds: 300 },
      cadence: { kind: "constant", value: 85 },
    },
    { type: "step", duration: { type: "time", seconds: 300 }, intensity: "coolDown" },
  ],
};

describe("writeFit", () => {
  test("round-trips everything FIT can say, unchanged and without warnings", () => {
    const written = writeFit(sample);
    assert.deepEqual(written.warnings, []);
    assert.deepEqual(parseFit(written.value), { value: sample, warnings: [] });
  });

  test("writes a running, swimming or cycling workout with its sport", () => {
    for (const sport of ["running", "swimming", "cycling"] as const) {
      const workout: Workout = { ...sample, sport };
      assert.equal(decodeFitWorkout(writeFit(workout).value).sport, sport);
      assert.deepEqual(parseFit(writeFit(workout).value).value, workout);
    }
  });

  test("names what a .fit file has no place for", () => {
    const { warnings } = writeFit({
      ...sample,
      description: "About",
      author: "Coach",
      focus: "threshold",
      tags: ["indoor"],
      steps: [
        {
          type: "step",
          duration: { type: "time", seconds: 60 },
          cues: [{ at: { type: "time", seconds: 10 }, text: "Go" }],
        },
      ],
    });
    assert.deepEqual(
      warnings.map((warning) => `${warning.at ?? "-"}: ${warning.message}`),
      [
        "-: The description has no place in a .fit file",
        '-: Focus "threshold" has no place in a .fit file',
        '-: Author "Coach" has no place in a .fit file',
        "-: Tags have no place in a .fit file",
        'steps.0: Cue "Go" has no place in a .fit file',
      ],
    );
  });

  test("refuses what changes the effort: ramps, max efforts, and thresholds it has no value for", () => {
    const workout: Workout = {
      name: "Strict",
      sport: "running",
      steps: [
        {
          type: "step",
          duration: { type: "time", seconds: 600 },
          target: { type: "power", unit: "ftp", level: { kind: "ramp", from: 0.5, to: 0.75 } },
        },
        { type: "step", duration: { type: "time", seconds: 30 }, target: { type: "maxEffort" } },
        {
          type: "step",
          duration: { type: "time", seconds: 600 },
          target: { type: "heartRate", unit: "threshold", level: { kind: "constant", value: 0.8 } },
        },
        {
          type: "step",
          duration: { type: "time", seconds: 600 },
          target: { type: "pace", unit: "threshold", level: { kind: "constant", value: 0.9 } },
        },
        powerStep(60, 10.5),
      ],
    };
    assert.deepEqual(messages(failure(() => writeFit(workout))), [
      "unsupported steps.0: A ramp has no place in a .fit file",
      "unsupported steps.1: A max effort has no place in a .fit file",
      "unsupported steps.2: Heart rate as a share of threshold needs a threshold heart rate to become bpm in a .fit file",
      "unsupported steps.3: Pace as a share of threshold needs a threshold pace to become speed in a .fit file",
      "unsupported steps.4: Power above 1000% of FTP has no place in a .fit file",
    ]);
  });

  test("turns threshold heart rate and pace into bpm and speed from the thresholds given", () => {
    const workout: Workout = {
      name: "Thresholds",
      sport: "running",
      steps: [
        {
          type: "step",
          duration: { type: "time", seconds: 600 },
          target: {
            type: "heartRate",
            unit: "threshold",
            level: { kind: "range", low: 0.8, high: 0.9 },
          },
        },
        {
          type: "step",
          duration: { type: "time", seconds: 600 },
          target: { type: "pace", unit: "threshold", level: { kind: "constant", value: 0.9 } },
        },
      ],
    };
    const written = writeFit(workout, { thresholdHeartRate: 170, thresholdPace: 4 });
    assert.deepEqual(
      written.warnings.map((warning) => `${warning.code} ${warning.at}: ${warning.message}`),
      [
        "converted steps.0: Heart rate as a share of threshold is written in bpm from a threshold heart rate of 170 bpm",
        "converted steps.1: Pace as a share of threshold is written as speed from a threshold pace of 4 m/s",
      ],
    );
    assert.deepEqual(
      parseFit(written.value).value.steps.map((block) => block.type === "step" && block.target),
      [
        { type: "heartRate", unit: "bpm", level: { kind: "range", low: 136, high: 153 } },
        { type: "pace", unit: "metersPerSecond", level: { kind: "constant", value: 3.6 } },
      ],
    );
  });

  test("rounds to FIT's precision and says so when that changes a value", () => {
    const written = writeFit({
      name: "Fine",
      sport: "cycling",
      steps: [powerStep(60.0004, 0.855)],
    });
    assert.deepEqual(
      written.warnings.map((warning) => warning.message),
      [
        "The step's length in milliseconds is rounded from 60000.4 to 60000, the precision of a .fit file",
        "Power as a percentage of FTP is rounded from 85.5 to 86, the precision of a .fit file",
      ],
    );
    assert.deepEqual(parseFit(written.value).value.steps, [powerStep(60, 0.86)]);
  });

  test("writes zero watts and zero bpm so they read back as zero", () => {
    const workout: Workout = {
      name: "Zero",
      sport: "cycling",
      steps: [
        {
          type: "step",
          duration: { type: "time", seconds: 60 },
          target: { type: "power", unit: "watts", level: { kind: "range", low: 0, high: 100 } },
        },
        {
          type: "step",
          duration: { type: "time", seconds: 60 },
          target: { type: "heartRate", unit: "bpm", level: { kind: "range", low: 0, high: 120 } },
        },
      ],
    };
    assert.deepEqual(parseFit(writeFit(workout).value).value, workout);
  });

  test("flattens nested repeats, keeping the repeat that takes fewer FIT steps", () => {
    const inner: Block = {
      type: "repeat",
      count: 10,
      steps: [powerStep(15, 1.5), powerStep(15, 0.5)],
    };
    const workout: Workout = {
      name: "Nested",
      sport: "cycling",
      steps: [{ type: "repeat", count: 3, name: "Sets", steps: [inner, powerStep(300, 0.5)] }],
    };
    const written = writeFit(workout);
    assert.deepEqual(written.warnings, [
      {
        code: "expanded",
        message:
          "The repeat is written out 3 times, which takes fewer FIT steps than repeats nested inside a FIT repeat would",
        at: "steps.0",
      },
      { code: "dropped", message: 'Name "Sets" is not kept', at: "steps.0" },
    ]);
    const fit = decodeFitWorkout(written.value);
    assert.equal(fit.steps.length, 3 * 4);
    const back = parseFit(written.value).value;
    assert.deepEqual(flatten(back.steps), flatten(workout.steps));

    const wide: Workout = {
      name: "Wide",
      sport: "cycling",
      steps: [
        {
          type: "repeat",
          count: 5,
          steps: [
            powerStep(60, 0.6),
            { type: "repeat", count: 2, steps: [powerStep(30, 1.2)] },
            powerStep(60, 0.6),
            powerStep(60, 0.7),
          ],
        },
      ],
    };
    const wideWritten = writeFit(wide);
    assert.deepEqual(wideWritten.warnings, [
      {
        code: "expanded",
        message: "The repeat is written out 2 times, because FIT repeats cannot nest",
        at: "steps.0.steps.1",
      },
    ]);
    assert.equal(decodeFitWorkout(wideWritten.value).steps.length, 6);
    assert.deepEqual(flatten(parseFit(wideWritten.value).value.steps), flatten(wide.steps));
  });
});

describe("writeFit with approximate", () => {
  test("writes a ramp as a staircase of steady steps that keeps its length and average", () => {
    const workout: Workout = {
      name: "Ramp",
      sport: "cycling",
      steps: [
        {
          type: "step",
          duration: { type: "time", seconds: 600 },
          target: { type: "power", unit: "ftp", level: { kind: "ramp", from: 0.5, to: 0.75 } },
          intensity: "warmUp",
          name: "Warm up",
          notes: "Build",
        },
        {
          type: "step",
          duration: { type: "distance", meters: 300 },
          target: {
            type: "pace",
            unit: "metersPerSecond",
            level: { kind: "ramp", from: 3, to: 4 },
          },
        },
        {
          type: "step",
          duration: { type: "time", seconds: 20 },
          target: { type: "power", unit: "watts", level: { kind: "ramp", from: 100, to: 300 } },
        },
      ],
    };
    const written = writeFit(workout, { approximate: true });
    assert.deepEqual(
      written.warnings.map((warning) => `${warning.code} ${warning.at}: ${warning.message}`),
      [
        "approximated steps.0: The ramp from 50% to 75% of FTP is written as 10 steady steps of 60 s, one per 60 s and at least two, each at the ramp's level at its midpoint, which keeps its length and average to FIT's precision",
        "approximated steps.1: The ramp from 3 to 4 m/s is written as 2 steady steps of 150 m, one per 200 m and at least two, each at the ramp's level at its midpoint, which keeps its length and average to FIT's precision",
        "approximated steps.2: The ramp from 100 to 300 W is written as 2 steady steps of 10 s, one per 60 s and at least two, each at the ramp's level at its midpoint, which keeps its length and average to FIT's precision",
      ],
    );
    const steps = flatten(parseFit(written.value).value.steps);
    assert.equal(steps.length, 14);
    const warmUp = steps.slice(0, 10);
    assert.deepEqual(
      warmUp.map(
        (step) =>
          step.target?.type === "power" &&
          step.target.level.kind === "constant" &&
          step.target.level.value,
      ),
      [0.51, 0.54, 0.56, 0.59, 0.61, 0.64, 0.66, 0.69, 0.71, 0.74],
    );
    assert.ok(warmUp.every((step) => step.name === "Warm up" && step.intensity === "warmUp"));
    assert.deepEqual(
      warmUp.map((step) => step.notes),
      ["Build", ...Array.from({ length: 9 }, () => undefined)],
    );
    assert.deepEqual(
      steps
        .slice(10)
        .map((step) => [step.duration, step.target?.type !== "maxEffort" && step.target?.level]),
      [
        [
          { type: "distance", meters: 150 },
          { kind: "constant", value: 3.25 },
        ],
        [
          { type: "distance", meters: 150 },
          { kind: "constant", value: 3.75 },
        ],
        [
          { type: "time", seconds: 10 },
          { kind: "constant", value: 150 },
        ],
        [
          { type: "time", seconds: 10 },
          { kind: "constant", value: 250 },
        ],
      ],
    );
  });

  test("splits a ramp's length exactly, to the millisecond", () => {
    const written = writeFit(
      {
        name: "Odd",
        sport: "cycling",
        steps: [
          {
            type: "step",
            duration: { type: "time", seconds: 100 },
            target: { type: "power", unit: "ftp", level: { kind: "ramp", from: 0.4, to: 0.6 } },
          },
        ],
      },
      { approximate: true },
    );
    const durations = decodeFitWorkout(written.value).steps.map(
      (step) => step.duration.type === "time" && step.duration.seconds,
    );
    assert.deepEqual(durations, [50, 50]);
    const thirds = writeFit(
      {
        name: "Thirds",
        sport: "cycling",
        steps: [
          {
            type: "step",
            duration: { type: "time", seconds: 120.001 },
            target: { type: "power", unit: "ftp", level: { kind: "ramp", from: 0.4, to: 0.6 } },
          },
        ],
      },
      { approximate: true },
    );
    assert.deepEqual(
      decodeFitWorkout(thirds.value).steps.map(
        (step) => step.duration.type === "time" && step.duration.seconds,
      ),
      [40.001, 40, 40],
    );
  });

  test("writes a max effort as a step with no target named all out", () => {
    const written = writeFit(
      {
        name: "Sprints",
        sport: "cycling",
        steps: [
          { type: "step", duration: { type: "time", seconds: 10 }, target: { type: "maxEffort" } },
          {
            type: "step",
            duration: { type: "time", seconds: 10 },
            target: { type: "maxEffort" },
            name: "Sprint",
            intensity: "active",
          },
        ],
      },
      { approximate: true },
    );
    assert.deepEqual(
      written.warnings.map((warning) => warning.message),
      [
        'The max effort is written as a step with no target named "All out"',
        'The max effort is written as a step with no target named "All out"',
      ],
    );
    assert.deepEqual(parseFit(written.value).value.steps, [
      {
        type: "step",
        duration: { type: "time", seconds: 10 },
        intensity: "active",
        name: "All out",
      },
      {
        type: "step",
        duration: { type: "time", seconds: 10 },
        intensity: "active",
        name: "Sprint (all out)",
      },
    ]);
  });

  test("still refuses thresholds it has no value for", () => {
    const error = failure(() =>
      writeFit(
        {
          name: "HR",
          sport: "running",
          steps: [
            {
              type: "step",
              duration: { type: "time", seconds: 60 },
              target: {
                type: "heartRate",
                unit: "threshold",
                level: { kind: "ramp", from: 0.7, to: 0.8 },
              },
            },
          ],
        },
        { approximate: true },
      ),
    );
    assert.deepEqual(messages(error), [
      "unsupported steps.0: Heart rate as a share of threshold needs a threshold heart rate to become bpm in a .fit file",
    ]);
  });
});

describe("parseWorkoutFile with .fit", () => {
  test("reads FIT bytes, falling back to the file's name only when the workout has none", () => {
    const bytes = reference("trainingpeaks-bike.fit");
    assert.equal(parseWorkoutFile("downloads/Mine.FIT", bytes).value.name, "Over-unders 3 x 9");
    assert.equal(
      parseWorkoutFile("Mine.fit", bytes.buffer as ArrayBuffer).value.name,
      "Over-unders 3 x 9",
    );
    const unnamed = encodeFitWorkout({
      sport: "cycling",
      steps: [{ duration: { type: "time", seconds: 60 } }],
    });
    assert.equal(parseWorkoutFile("downloads/Mine.fit", unnamed).value.name, "Mine");
  });

  test("passes the athlete's settings through to the FIT reader", () => {
    const { value } = parseWorkoutFile("run.fit", reference("trainingpeaks-run-heart-rate.fit"), {
      maxHeartRate: 200,
    });
    assert.equal(value.steps.length, 2);
  });

  test("refuses a .fit file read as text", () => {
    assert.deepEqual(messages(failure(() => parseWorkoutFile("ride.fit", "text"))), [
      "malformed -: A .fit file is binary; read it as bytes, not text",
    ]);
  });

  test("reads text formats from bytes too", () => {
    const zwo = new TextEncoder().encode(
      '<workout_file><name>Bytes</name><sportType>bike</sportType><workout><SteadyState Duration="60" Power="0.5"/></workout></workout_file>',
    );
    assert.equal(parseWorkoutFile("bytes.zwo", zwo).value.name, "Bytes");
  });
});
