import assert from "node:assert/strict";
import { test } from "node:test";

import { Miniflare } from "miniflare";
import { rolldown } from "rolldown";

import { sampleRide } from "../../fit/test/goldens.ts";
import { statisticsOfFile } from "./worker.ts";

async function browserBundle(input: string): Promise<{ code: string; imports: string[] }> {
  const bundle = await rolldown({ input, platform: "browser" });
  try {
    const { output } = await bundle.generate({ format: "esm", codeSplitting: false });
    const [chunk] = output;
    assert.equal(chunk.type, "chunk");
    return { code: chunk.code, imports: [...chunk.imports, ...chunk.dynamicImports] };
  } finally {
    await bundle.close();
  }
}

test("bundles for the browser with no imports left, so nothing needs Node", async () => {
  const { imports } = await browserBundle(new URL("../src/index.ts", import.meta.url).pathname);
  assert.deepEqual(imports, []);
});

test("analyzes an uploaded file inside the Workers runtime as it does in Node", async () => {
  const { code } = await browserBundle(new URL("worker.ts", import.meta.url).pathname);
  const runtime = new Miniflare({
    modules: [{ type: "ESModule", path: "worker.mjs", contents: code }],
    compatibilityDate: "2026-07-30",
    cf: false,
  });
  try {
    const response = await runtime.dispatchFetch("https://analysis.test/", {
      method: "POST",
      body: sampleRide(),
    });
    assert.equal(response.status, 200);
    const expected = statisticsOfFile(sampleRide());
    assert.deepEqual(await response.json(), expected);
    assert.equal(expected.power_stress_tss, 24);
  } finally {
    await runtime.dispose();
  }
});
