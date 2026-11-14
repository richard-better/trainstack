import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const swiftSource = "apps/ride/RideKit/Sources/RideData/WorkoutTemplate.swift";
const serverCopy = "hosted/apps/api/src/workouts/ride-library.json";
const packageFixture = "packages/workout/test/fixtures/ride-library.json";

const powerZones = ["recovery", "endurance", "tempo", "threshold", "vo2Max", "anaerobic"];

function swiftLibrary() {
  const source = readFileSync(swiftSource, "utf8");
  const start = source.indexOf("public static let library: [WorkoutTemplate] = [");
  const end = source.indexOf("public static func named", start);
  assert.ok(start > 0 && end > start, `${swiftSource} still declares WorkoutTemplate.library`);
  const body = source.slice(start, end);
  const entries = body.split(/\n {4}\.init\(\n/).slice(1);
  return entries.map((entry) => {
    const name = /name: "([^"]*)"/.exec(entry)?.[1];
    const category = /category: \.(\w+)/.exec(entry)?.[1];
    const about = /about:\s*"([^"]*)"/.exec(entry)?.[1];
    const steps = /steps: (minutes\([\s\S]*?\)),\s*about:/.exec(entry)?.[1];
    const cueList = /cues: \[([\s\S]*?)\n {6}\]/.exec(entry)?.[1] ?? "";
    const cues = [...cueList.matchAll(/\.cue\((\d+), (?:at: ([\d.]+), )?"([^"]*)"\)/g)].map(
      ([, step, at, text]) => ({ step: Number(step), at: Number(at ?? 0), text }),
    );
    assert.ok(name && category && about && steps, `every template reads: ${entry}`);
    const expression = steps
      .replace(/\(([^()[\]]+?),\s*([\d.]+)\)/g, "[$1, $2]")
      .replace(/\.dropLast\(\)/g, ".slice(0, -1)")
      .replace(/^minutes\(([\s\S]*)\)$/, "minutes(sum($1))")
      .replace(/\s\+\s/g, ", ");
    const evaluated = vm.runInNewContext(expression, {
      minutes: (pairs) =>
        pairs.map(([minutes, percent]) => ({
          duration: Math.round(minutes * 60),
          intensity: percent / 100,
        })),
      repeated: (count, pairs) => Array.from({ length: count }, () => pairs).flat(),
      sum: (...parts) => parts.flat(),
    });
    return { name, category: powerZones.indexOf(category), about, steps: evaluated, cues };
  });
}

const rounded = (library) =>
  JSON.parse(JSON.stringify(library), (_, value) =>
    typeof value === "number" ? Number(value.toPrecision(12)) : value,
  );

const normalised = (library) =>
  library.map(({ name, category, about, steps, cues }) => ({
    name,
    category,
    about,
    steps: steps.map(({ duration, intensity }) => ({ duration, intensity })),
    cues: (cues ?? []).map(({ step, at, text }) => ({ step, at, text })),
  }));

test("the server's built-in library is Ride's WorkoutTemplate.library, read from the Swift source", () => {
  const fromSwift = swiftLibrary();
  assert.equal(fromSwift.length, 11);
  assert.ok(
    fromSwift.every((template) => template.cues.length > 0),
    "every bundled workout's text is read from the Swift source",
  );
  const server = JSON.parse(readFileSync(serverCopy, "utf8"));
  assert.deepEqual(
    rounded(normalised(server)),
    rounded(normalised(fromSwift)),
    `${serverCopy} differs from ${swiftSource}: regenerate it as packages/workout/README.md describes`,
  );
});

test("the server's built-in library and the workout package's fixture are the same file", () => {
  assert.equal(readFileSync(serverCopy, "utf8"), readFileSync(packageFixture, "utf8"));
});
