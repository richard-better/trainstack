import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { fitChecksum } from "../src/checksum.ts";
import { FitDecodeError, decodeFit, summarizeFit } from "../src/index.ts";
import { FitWriter, fitTime } from "./fit-writer.ts";
import { sampleRide, trace, traceNames } from "./goldens.ts";

const goldens = {
  sampleRide: sampleRide(),
  ...Object.fromEntries(traceNames.map((name) => [name, trace(name)])),
};

test("summarizes each golden file exactly as the full decode does, without its records", () => {
  for (const [name, data] of Object.entries(goldens)) {
    const { fileId, workoutName, summary, sessions, laps } = decodeFit(data);
    assert.deepEqual(summarizeFit(data), { fileId, workoutName, summary, sessions, laps }, name);
  }
});

test("fails as the full decode does", () => {
  const data = sampleRide();
  data[Math.floor(data.length / 2)]! ^= 0xff;
  assert.throws(
    () => summarizeFit(data),
    (error) => error instanceof FitDecodeError && error.code === "badChecksum",
  );
});

test("rejects a file with more laps than an activity can have, before keeping them all", () => {
  const writer = new FitWriter().define(0, 19, [
    { number: 253, type: "uint32" },
    { number: 2, type: "uint32" },
  ]);
  const start = fitTime("2026-01-01T00:00:00Z");
  for (let index = 0; index <= 10_000; index++) writer.data(0, [start + index, start + index]);
  const data = writer.file();
  for (const decode of [decodeFit, summarizeFit]) {
    assert.throws(
      () => decode(data),
      (error) => error instanceof FitDecodeError && error.code === "tooLarge",
    );
  }
});

function manyDeveloperFieldDescriptions(count: number): Uint8Array {
  const definitions = [
    0x40, 0, 0, 206, 0, 4, 0, 4, 0x86, 1, 1, 0x02, 2, 1, 0x02, 3, 4, 0x07, 0x41, 0, 0, 20, 0, 1,
    253, 4, 0x86,
  ];
  const descriptionSize = 1 + 4 + 1 + 1 + 4;
  const dataSize = definitions.length + count * descriptionSize + 5;
  const bytes = new Uint8Array(14 + dataSize + 2);
  const view = new DataView(bytes.buffer);
  bytes.set([14, 0x20, 0x5c, 0x08]);
  view.setUint32(4, dataSize, true);
  bytes.set([0x2e, 0x46, 0x49, 0x54], 8);
  view.setUint16(12, fitChecksum(bytes.subarray(0, 12)), true);
  bytes.set(definitions, 14);
  let position = 14 + definitions.length;
  for (let index = 0; index < count; index++) {
    view.setUint32(position + 1, 0x100 + index, true);
    bytes.set([0, 2, 0x61, 0x62, 0x63, 0], position + 5);
    position += descriptionSize;
  }
  bytes[position] = 1;
  view.setUint32(position + 1, fitTime("2026-01-01T00:00:00Z"), true);
  position += 5;
  view.setUint16(position, fitChecksum(bytes.subarray(0, position)), true);
  return bytes;
}

test("keeps no developer field descriptions a definition could never refer to", () => {
  const directory = mkdtempSync(join(tmpdir(), "fit-"));
  try {
    const path = join(directory, "descriptions.fit");
    writeFileSync(path, manyDeveloperFieldDescriptions(600_000));
    const index = new URL("../src/index.ts", import.meta.url).href;
    for (const decode of ["decodeFit", "summarizeFit"]) {
      const script = `
        import { readFileSync } from "node:fs";
        const fit = await import(${JSON.stringify(index)});
        const activity = fit.${decode}(readFileSync(process.argv[1]));
        console.log(activity.summary.startTime.toISOString());
      `;
      const decoded = spawnSync(
        process.execPath,
        ["--max-old-space-size=16", "--input-type=module", "-e", script, path],
        { encoding: "utf8" },
      );
      assert.equal(decoded.status, 0, `${decode}: ${decoded.stderr}`);
      assert.equal(decoded.stdout.trim(), "2026-01-01T00:00:00.000Z");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("summarizes sessions and laps that carry only developer fields as the full decode does", () => {
  const data = new FitWriter()
    .define(0, 206, [
      { number: 0, type: "uint8" },
      { number: 1, type: "uint8" },
      { number: 2, type: "uint8" },
      { number: 3, type: "string", size: 8 },
    ])
    .data(0, [0, 0, 2, "effort"])
    .define(1, 19, [], { developerFields: [{ number: 0, size: 1, index: 0 }] })
    .data(1, [], [7])
    .define(2, 18, [], { developerFields: [{ number: 0, size: 1, index: 0 }] })
    .data(2, [], [7])
    .file();
  const { fileId, workoutName, summary, sessions, laps } = decodeFit(data);
  assert.equal(sessions.length, 1);
  assert.equal(laps.length, 1);
  assert.deepEqual(summarizeFit(data), { fileId, workoutName, summary, sessions, laps });
});
