import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const heapMegabytes = 24;

test(`analyzes a 24 hour run at 1 Hz in under a second, with a ${heapMegabytes} MB heap of which its records take 20`, () => {
  const run = spawnSync(
    process.execPath,
    [`--max-old-space-size=${heapMegabytes}`, new URL("day-long.ts", import.meta.url).pathname],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout) as {
    records: number;
    milliseconds: number;
    typedArrayBytes: number;
    efforts: number;
    laps: number;
  };
  assert.equal(result.records, 24 * 60 * 60 + 1);
  assert.equal(result.efforts, 7);
  assert.equal(result.laps, 96);
  assert.ok(result.milliseconds < 1000, `${result.milliseconds} ms`);
  assert.ok(result.typedArrayBytes < 16 * 1024 * 1024, `${result.typedArrayBytes} bytes`);
});
