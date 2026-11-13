import assert from "node:assert/strict";
import { test } from "node:test";

import { Miniflare } from "miniflare";
import { rolldown } from "rolldown";

import { sampleRide } from "../../fit/test/goldens.ts";
import { file } from "./files.ts";

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
import { decodeActivityFile, summarizeActivityFile, ActivityFileError } from "./activity-file.mjs";

export default {
  async fetch(request) {
    try {
      const bytes = await request.arrayBuffer();
      const { format, summary, laps, records } = decodeActivityFile(bytes);
      const summarized = summarizeActivityFile(bytes);
      const same = JSON.stringify(summarized.summary) === JSON.stringify(summary);
      return Response.json({ format, summary, laps: laps.length, records: records.length, same });
    } catch (error) {
      if (error instanceof ActivityFileError) return Response.json({ error: error.code }, { status: 422 });
      throw error;
    }
  },
};
`;

function utf16(bytes: Uint8Array): Uint8Array {
  const source = new TextDecoder().decode(bytes);
  const encoded = new Uint8Array(2 + source.length * 2);
  encoded.set([0xfe, 0xff]);
  for (let index = 0; index < source.length; index++) {
    encoded[2 + index * 2] = source.charCodeAt(index) >> 8;
    encoded[3 + index * 2] = source.charCodeAt(index) & 0xff;
  }
  return encoded;
}

test("bundles for the browser with no imports at all", async () => {
  const { code, imports } = await browserBundle();
  assert.deepEqual(imports, []);
  assert.ok(code.length < 80_000, `${code.length} bytes`);
  assert.doesNotMatch(code, /DOMParser/);
});

test("decodes FIT, GPX and TCX inside the Workers runtime", async () => {
  const { code } = await browserBundle();
  const runtime = new Miniflare({
    modules: [
      { type: "ESModule", path: "worker.mjs", contents: worker },
      { type: "ESModule", path: "activity-file.mjs", contents: code },
    ],
    compatibilityDate: "2026-07-30",
    cf: false,
  });
  const decode = async (body: Uint8Array | string) => {
    const response = await runtime.dispatchFetch("https://activity-file.test/", {
      method: "POST",
      body,
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  try {
    const fit = await decode(sampleRide());
    assert.equal(fit.status, 200);
    assert.deepEqual([fit.body.format, fit.body.records, fit.body.same], ["fit", 1801, true]);

    const gpx = await decode(file("strava-ride.gpx"));
    assert.equal(gpx.status, 200);
    const gpxSummary = gpx.body.summary as Record<string, unknown>;
    assert.deepEqual([gpx.body.format, gpx.body.laps, gpx.body.records], ["gpx", 0, 4]);
    assert.deepEqual(
      [gpxSummary.startTime, gpxSummary.sport, gpxSummary.averagePower, gpxSummary.maxHeartRate],
      ["2026-09-12T06:58:31.000Z", "cycling", 160, 131],
    );
    assert.ok(Math.abs((gpxSummary.distanceMetres as number) - 53.08) < 0.01);

    const tcx = await decode(file("garmin-connect-ride.tcx"));
    assert.equal(tcx.status, 200);
    assert.deepEqual(
      [tcx.body.format, tcx.body.laps, tcx.body.records, tcx.body.same],
      ["tcx", 2, 5, true],
    );

    const bigEndian = await decode(utf16(file("strava-run.tcx")));
    assert.deepEqual([bigEndian.status, bigEndian.body.records], [200, 3]);

    const rejected = await decode("not an activity, only some text");
    assert.equal(rejected.status, 422);
    assert.deepEqual(rejected.body, { error: "unrecognizedFormat" });
  } finally {
    await runtime.dispose();
  }
});
