import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { sampleRide, trace, traceNames } from "../../fit/test/goldens.ts";
import {
  ActivityFileError,
  decodeActivityFile,
  summarizeActivityFile,
  type ActivityFileFormat,
} from "../src/index.ts";
import { denseFit, denseGpx, denseTcx } from "./dense.ts";
import { file, fileNames, text } from "./files.ts";

const decodable = [
  sampleRide(),
  ...traceNames.map(trace),
  ...fileNames
    .filter((name) => !["course.tcx", "route-without-times.gpx"].includes(name))
    .map(file),
];

test("summarizes every file exactly as the full decode does", () => {
  for (const data of decodable) {
    const { format, name, summary, laps } = decodeActivityFile(data);
    assert.deepEqual(summarizeActivityFile(data), { format, name, summary, laps });
  }
});

test("fails as the full decode does", () => {
  const broken = sampleRide();
  broken[Math.floor(broken.length / 2)]! ^= 0xff;
  for (const [data, code] of [
    [broken, "badChecksum"],
    [file("course.tcx"), "noActivity"],
    [file("route-without-times.gpx"), "noActivity"],
    [text("<gpx><trk>"), "truncated"],
    [text("not an activity"), "unrecognizedFormat"],
  ] as const) {
    assert.throws(
      () => summarizeActivityFile(data),
      (error) => error instanceof ActivityFileError && error.code === code,
    );
  }
});

const heapMegabytes = 16;
const fileBytes = 25 * 1024 * 1024;

function run(path: string, mode: "summary" | "full") {
  return spawnSync(
    process.execPath,
    [
      `--max-old-space-size=${heapMegabytes}`,
      new URL("summarize-file.ts", import.meta.url).pathname,
      path,
      mode,
    ],
    { encoding: "utf8" },
  );
}

test(`summarizes a dense 25 MB file of each format in a ${heapMegabytes} MB heap that the full decode runs out of`, (context) => {
  const directory = mkdtempSync(join(tmpdir(), "activity-file-"));
  try {
    const files: Record<ActivityFileFormat, Uint8Array> = {
      fit: denseFit(fileBytes),
      gpx: denseGpx(fileBytes),
      tcx: denseTcx(fileBytes),
    };
    for (const [format, data] of Object.entries(files)) {
      assert.ok(data.length > fileBytes - 4096, `${format} is ${data.length} bytes`);
      const path = join(directory, `dense.${format}`);
      writeFileSync(path, data);

      const summarized = run(path, "summary");
      assert.equal(summarized.status, 0, summarized.stderr);
      const result = JSON.parse(summarized.stdout) as {
        format: string;
        summary: { averagePower: number; maxHeartRate: number };
        maxRssKilobytes: number;
        rssBeforeKilobytes: number;
      };
      assert.equal(result.format, format);
      assert.equal(result.summary.averagePower, 224);
      assert.equal(result.summary.maxHeartRate, 159);
      context.diagnostic(
        `${format}: resident memory grew ${Math.round((result.maxRssKilobytes - result.rssBeforeKilobytes) / 1024)} MB while summarizing`,
      );

      assert.notEqual(run(path, "full").status, 0, `${format} decoded in full within the cap`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
