import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { Miniflare } from "miniflare";
import { rolldown } from "rolldown";

let directory;
let runtime;
let modules;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "trainstack-workout-"));
  const entry = join(directory, "entry.mjs");
  await writeFile(
    entry,
    `import { parseWorkoutFile, WorkoutFormatError, writeWorkout } from ${JSON.stringify(resolve("packages/workout/src/index.ts"))};
export default {
  async fetch(request) {
    const url = new URL(request.url);
    try {
      const imported = parseWorkoutFile(url.searchParams.get("name"), await request.text());
      const written = writeWorkout(url.searchParams.get("to"), imported.value, { ftp: 250 });
      return Response.json({ workout: imported.value, text: written.value, warnings: written.warnings });
    } catch (error) {
      if (!(error instanceof WorkoutFormatError)) throw error;
      return Response.json({ format: error.format, issues: error.issues }, { status: 422 });
    }
  },
};
`,
  );
  const bundle = await rolldown({ input: entry, platform: "browser" });
  try {
    const { output } = await bundle.write({
      file: join(directory, "worker.mjs"),
      format: "esm",
      codeSplitting: false,
    });
    modules = output.flatMap((chunk) => (chunk.type === "chunk" ? Object.keys(chunk.modules) : []));
  } finally {
    await bundle.close();
  }
  runtime = new Miniflare({
    modulesRoot: directory,
    modules: [{ type: "ESModule", path: join(directory, "worker.mjs") }],
    compatibilityDate: "2026-07-30",
  });
  await runtime.ready;
});

after(async () => {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
});

test("the workout package bundles for browsers without Node built-ins", () => {
  assert.ok(modules.some((id) => id.includes("/packages/workout/src/zwo.ts")));
  assert.deepEqual(
    modules.filter((id) => id.startsWith("node:") || id.includes("\0node:")),
    [],
  );
});

async function convert(fixture, to) {
  const response = await runtime.dispatchFetch(
    `https://worker.test/convert?name=${fixture}&to=${to}`,
    { method: "POST", body: await readFile(`packages/workout/test/fixtures/${fixture}`, "utf8") },
  );
  return { status: response.status, body: await response.json() };
}

test("the workout package converts files inside the Workers runtime", async () => {
  const { status, body } = await convert("sweet-spot.erg", "zwo");
  assert.equal(status, 200);
  assert.equal(body.workout.name, "Sweet spot 2x15");
  assert.match(body.text, /<SteadyState Duration="900" Power="0.9">/);
  assert.deepEqual(body.warnings, []);
});

test("the workout package reports what a format cannot hold inside the Workers runtime", async () => {
  const { status, body } = await convert("threshold-builder.zwo", "erg");
  assert.equal(status, 422);
  assert.equal(body.format, "erg");
  assert.ok(
    body.issues.some((issue) => issue.message === "A power range has no place in this format"),
  );
});
