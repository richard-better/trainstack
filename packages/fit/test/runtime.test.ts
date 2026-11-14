import assert from "node:assert/strict";
import { test } from "node:test";

import { Miniflare } from "miniflare";
import { rolldown } from "rolldown";

import { sampleRide } from "./goldens.ts";

async function browserBundle(): Promise<{ code: string; imports: string[] }> {
  const bundle = await rolldown({
    input: new URL("../src/index.ts", import.meta.url).pathname,
    platform: "browser",
  });
  try {
    const { output } = await bundle.generate({ format: "esm" });
    const [chunk] = output;
    assert.equal(chunk.type, "chunk");
    return { code: chunk.code, imports: [...chunk.imports, ...chunk.dynamicImports] };
  } finally {
    await bundle.close();
  }
}

const worker = `
import { decodeFit, FitDecodeError } from "./fit.mjs";

export default {
  async fetch(request) {
    try {
      const { summary, records } = decodeFit(await request.arrayBuffer());
      return Response.json({ summary, records: records.length });
    } catch (error) {
      if (error instanceof FitDecodeError) return Response.json({ error: error.code }, { status: 422 });
      throw error;
    }
  },
};
`;

test("bundles for the browser with no imports at all", async () => {
  const { code, imports } = await browserBundle();
  assert.deepEqual(imports, []);
  assert.ok(code.length < 56_000, `${code.length} bytes`);
});

test("decodes a FIT file inside the Workers runtime", async () => {
  const { code } = await browserBundle();
  const runtime = new Miniflare({
    modules: [
      { type: "ESModule", path: "worker.mjs", contents: worker },
      { type: "ESModule", path: "fit.mjs", contents: code },
    ],
    compatibilityDate: "2026-07-30",
    cf: false,
  });
  try {
    const decoded = await runtime.dispatchFetch("https://fit.test/", {
      method: "POST",
      body: sampleRide(),
    });
    assert.equal(decoded.status, 200);
    assert.deepEqual(await decoded.json(), {
      summary: {
        startTime: "2026-10-06T14:21:15.000Z",
        utcOffsetSeconds: 7200,
        sport: "cycling",
        subSport: "generic",
        elapsedSeconds: 1800,
        timerSeconds: 1800,
        distanceMetres: 14389,
        calories: 247,
        averageSpeedMetresPerSecond: 7.993,
        maxSpeedMetresPerSecond: 8.576,
        averageHeartRate: 146,
        maxHeartRate: 167,
        averageCadence: 70,
        maxCadence: 91,
        averagePower: 137,
        maxPower: 177,
      },
      records: 1801,
    });

    const rejected = await runtime.dispatchFetch("https://fit.test/", {
      method: "POST",
      body: "not a FIT file, only some text",
    });
    assert.equal(rejected.status, 422);
    assert.deepEqual(await rejected.json(), { error: "notAFitFile" });
  } finally {
    await runtime.dispose();
  }
});
