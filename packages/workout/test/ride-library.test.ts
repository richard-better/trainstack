import { describe, expect, test } from "vite-plus/test";
import {
  type Focus,
  flatten,
  parseErg,
  parseMrc,
  parseZwo,
  totals,
  type Workout,
  workoutSchema,
  writeErg,
  writeMrc,
  writeZwo,
} from "../src/index";
import { fixture } from "./fixtures";

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

describe.each(library.map((template) => [template.name, template] as const))(
  "Ride's bundled workout %s",
  (_, template) => {
    const workout = fromRideTemplate(template);

    test("converts into a valid workout with the same duration", () => {
      expect(workoutSchema.parse(workout)).toEqual(workout);
      expect(totals(workout.steps).seconds).toBe(
        template.steps.reduce((sum, step) => sum + step.duration, 0),
      );
    });

    test("survives .zwo and .mrc unchanged apart from its focus", () => {
      const zwo = writeZwo(workout);
      expect(zwo.warnings.map((warning) => warning.code)).toEqual(["dropped"]);
      expect(parseZwo(zwo.value).value).toEqual({ ...workout, focus: undefined });
      const mrc = writeMrc(workout);
      expect(flatten(parseMrc(mrc.value).value.steps)).toEqual(flatten(workout.steps));
    });

    test("survives .erg as watts at a given FTP", () => {
      const erg = parseErg(writeErg(workout, { ftp }).value).value;
      expect(
        flatten(erg.steps).map((step) => [
          step.duration,
          step.target?.type === "power" && step.target.level.kind === "constant"
            ? step.target.level.value
            : undefined,
        ]),
      ).toEqual(
        template.steps.map((step) => [
          { type: "time", seconds: step.duration },
          Number((step.intensity * ftp).toFixed(2)),
        ]),
      );
    });
  },
);

test("the fixture holds every workout Ride bundles", () => {
  expect(library.map((template) => template.name)).toEqual([
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
  ]);
});
