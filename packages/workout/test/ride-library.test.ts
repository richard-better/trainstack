import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type Focus,
  flatten,
  parseErg,
  parseFit,
  parseMrc,
  parseZwo,
  totals,
  type Workout,
  workoutSchema,
  writeErg,
  writeFit,
  writeMrc,
  writeZwo,
} from "../src/index.ts";
import { fixture } from "./fixtures.ts";

type RideTemplate = {
  name: string;
  category: number;
  about: string;
  steps: { duration: number; intensity: number }[];
};

const powerZones: Focus[] = ["recovery", "endurance", "tempo", "threshold", "vo2Max", "anaerobic"];

function fromRideTemplate(template: RideTemplate): Workout {
  return {
    name: template.name,
    sport: "cycling",
    description: template.about,
    focus: powerZones[template.category],
    steps: template.steps.map((step) => ({
      type: "step",
      duration: { type: "time", seconds: step.duration },
      target: { type: "power", unit: "ftp", level: { kind: "constant", value: step.intensity } },
    })),
  };
}

const library = JSON.parse(fixture("ride-library.json")) as RideTemplate[];
const ftp = 250;

for (const [label, template] of library.map((template) => [template.name, template] as const)) {
  describe(`Ride's bundled workout ${String(label)}`, () => {
    const workout = fromRideTemplate(template);

    test("converts into a valid workout with the same duration", () => {
      assert.deepEqual(workoutSchema.parse(workout), workout);
      assert.equal(
        totals(workout.steps).seconds,
        template.steps.reduce((sum, step) => sum + step.duration, 0),
      );
    });

    test("survives .zwo and .mrc unchanged apart from its focus", () => {
      const zwo = writeZwo(workout);
      assert.deepEqual(
        zwo.warnings.map((warning) => warning.code),
        ["dropped"],
      );
      const withoutFocus: Workout = { ...workout };
      delete withoutFocus.focus;
      assert.deepEqual(parseZwo(zwo.value).value, withoutFocus);
      const mrc = writeMrc(workout);
      assert.deepEqual(flatten(parseMrc(mrc.value).value.steps), flatten(workout.steps));
    });

    test("survives .fit unchanged apart from its description and focus", () => {
      const fit = writeFit(workout);
      assert.deepEqual(
        fit.warnings.map((warning) => warning.code),
        ["dropped", "dropped"],
      );
      const { description: _description, focus: _focus, ...kept } = workout;
      assert.deepEqual(parseFit(fit.value), { value: kept, warnings: [] });
    });

    test("survives .erg as watts at a given FTP", () => {
      const erg = parseErg(writeErg(workout, { ftp }).value).value;
      assert.deepEqual(
        flatten(erg.steps).map((step) => [
          step.duration,
          step.target?.type === "power" && step.target.level.kind === "constant"
            ? step.target.level.value
            : undefined,
        ]),

        template.steps.map((step) => [
          { type: "time", seconds: step.duration },
          Number((step.intensity * ftp).toFixed(2)),
        ]),
      );
    });
  });
}

test("the fixture holds every workout Ride bundles", () => {
  assert.deepEqual(
    library.map((template) => template.name),
    [
      "Zone 3 · 3×10",
      "Threshold waves 3×12",
      "Ramp openers 30",
      "Over-unders 2×10",
      "Long endurance 90",
      "VO2 max booster",
      "Tabata 4×40/20",
      "Recovery 30",
      "Threshold classic 60",
      "Pixel sprints 30",
      "Quick test 45s",
    ],
  );
});
