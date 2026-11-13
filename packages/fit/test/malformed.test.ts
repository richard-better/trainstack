import assert from "node:assert/strict";
import { test } from "node:test";

import { fitChecksum } from "../src/checksum.ts";
import { FitDecodeError, decodeFit, type FitDecodeErrorCode } from "../src/index.ts";
import { readFitMessages } from "../src/reader.ts";
import { FitWriter, fitTime } from "./fit-writer.ts";
import { sampleRide, trace, traceNames } from "./goldens.ts";

function assertFails(data: Uint8Array, code: FitDecodeErrorCode) {
  assert.throws(
    () => decodeFit(data),
    (error) => error instanceof FitDecodeError && error.code === code,
  );
}

function withChecksum(bytes: Uint8Array): Uint8Array {
  const end = bytes.length - 2;
  const checksum = fitChecksum(bytes, 0, end);
  bytes[end] = checksum & 0xff;
  bytes[end + 1] = checksum >> 8;
  return bytes;
}

function random(seed: number) {
  let state = seed;
  return (below: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) % below;
  };
}

test("rejects data that is not a FIT file", () => {
  assertFails(new Uint8Array(64).fill(0x41), "notAFitFile");
  assertFails(new TextEncoder().encode("not a FIT file, only some text"), "notAFitFile");
});

test("rejects data too short to hold a header", () => {
  assertFails(new Uint8Array([0x0e, 0x10]), "truncated");
  assertFails(new Uint8Array(), "truncated");
});

test("rejects a file whose bytes no longer match its checksum", () => {
  const data = sampleRide();
  data[Math.floor(data.length / 2)]! ^= 0xff;
  assertFails(data, "badChecksum");
});

test("rejects a file cut short", () => {
  const data = sampleRide();
  assertFails(data.subarray(0, data.length - 40), "truncated");
});

test("rejects a data message whose definition never came", () => {
  assertFails(new FitWriter().raw(0x03, 0x00).file(), "malformed");
});

test("rejects a message that runs past the end of the data", () => {
  const data = new FitWriter()
    .define(0, 20, [
      { number: 253, type: "uint32" },
      { number: 7, type: "uint16" },
    ])
    .raw(0x00, 0x01, 0x02)
    .file();
  assertFails(data, "truncated");
});

test("rejects a file with neither sessions nor records", () => {
  const data = new FitWriter()
    .define(0, 0, [
      { number: 0, type: "enum" },
      { number: 4, type: "uint32" },
    ])
    .data(0, [4, fitTime("2026-01-01T00:00:00Z")])
    .file();
  assertFails(data, "noActivity");
});

test("fails with a FitDecodeError at every length a golden file could be cut to", () => {
  const data = trace("trainer-and-strap");
  for (let length = 0; length < data.length; length++) {
    assert.throws(
      () => decodeFit(data.subarray(0, length)),
      FitDecodeError,
      `cut to ${length} bytes`,
    );
  }
});

test("decodes or fails with a FitDecodeError when bytes are corrupted behind a valid checksum", () => {
  const next = random(64);
  const goldens = [sampleRide(), ...traceNames.map(trace)];
  for (let round = 0; round < 2000; round++) {
    const data = goldens[round % goldens.length]!.slice();
    const changes = 1 + next(8);
    for (let change = 0; change < changes; change++) {
      data[next(data.length - 2)] = next(256);
    }
    try {
      decodeFit(withChecksum(data));
    } catch (error) {
      assert.ok(error instanceof FitDecodeError, `round ${round}: ${String(error)}`);
    }
  }
});

test("keeps nothing for messages that carry no data, however many a file repeats", () => {
  const zeroSizeFields = Array.from({ length: 255 }, (_, number) => ({
    number,
    type: "uint8" as const,
    size: 0,
  }));
  const writer = new FitWriter().define(0, 20, zeroSizeFields);
  writer.raw(...new Array<number>(50_000).fill(0x00));
  writer.raw(...new Array<number>(50_000).fill(0x81));
  const data = writer
    .define(1, 20, [{ number: 253, type: "uint32" }])
    .data(1, [fitTime("2026-01-01T00:00:00Z")])
    .file();
  assert.equal(readFitMessages(data).length, 1);
  assert.equal(decodeFit(data).records.length, 1);
});
