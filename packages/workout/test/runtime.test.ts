import assert from "node:assert/strict";
import { test } from "node:test";

import { Miniflare } from "miniflare";
import { rolldown } from "rolldown";

import { fixture } from "./fixtures.ts";

async function browserBundle(): Promise<{ code: string; imports: string[] }> {
  const bundle = await rolldown({
    input: new URL("../src/index.ts", import.meta.url).pathname,
    platform: "browser",
  });
  try {
    const { output } = await bundle.generate({ format: "esm", codeSplitting: false });
    assert.equal(output.length, 1);
    const [chunk] = output;
    assert.equal(chunk.type, "chunk");
    return { code: chunk.code, imports: [...chunk.imports, ...chunk.dynamicImports] };
  } finally {
    await bundle.close();
  }
}

const worker = `
import { parseWorkoutFile, WorkoutFormatError, writeWorkout } from "./workout.mjs";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    try {
      const imported = parseWorkoutFile(url.searchParams.get("name"), await request.text());
      const written = writeWorkout(url.searchParams.get("to"), imported.value, { ftp: 250 });
      return Response.json({ name: imported.value.name, text: written.value, warnings: written.warnings });
    } catch (error) {
      if (error instanceof WorkoutFormatError) {
        return Response.json({ format: error.format, issues: error.issues }, { status: 422 });
      }
      throw error;
    }
  },
};
`;

test("bundles for the browser with no imports left, so nothing needs Node", async () => {
  const { imports } = await browserBundle();
  assert.deepEqual(imports, []);
});

test("converts workout files inside the Workers runtime", async () => {
  const { code } = await browserBundle();
  const runtime = new Miniflare({
    modules: [
      { type: "ESModule", path: "worker.mjs", contents: worker },
      { type: "ESModule", path: "workout.mjs", contents: code },
    ],
    compatibilityDate: "2026-07-30",
    cf: false,
  });
  try {
    const converted = await runtime.dispatchFetch(
      "https://workout.test/?name=sweet-spot.erg&to=zwo",
      { method: "POST", body: fixture("sweet-spot.erg") },
    );
    assert.equal(converted.status, 200);
    const body = (await converted.json()) as { name: string; text: string; warnings: unknown[] };
    assert.equal(body.name, "Sweet spot 2x15");
    assert.match(body.text, /<SteadyState Duration="900" Power="0.9">/);
    assert.deepEqual(body.warnings, []);

    const rejected = await runtime.dispatchFetch(
      "https://workout.test/?name=threshold-builder.zwo&to=erg",
      { method: "POST", body: fixture("threshold-builder.zwo") },
    );
    assert.equal(rejected.status, 422);
    const failure = (await rejected.json()) as { format: string; issues: { message: string }[] };
    assert.equal(failure.format, "erg");
    assert.ok(
      failure.issues.some((issue) => issue.message === "A power range has no place in this format"),
    );
  } finally {
    await runtime.dispose();
  }
});
