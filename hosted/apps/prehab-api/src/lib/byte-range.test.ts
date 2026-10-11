import { expect, it } from "vitest";
import { byteRange } from "./byte-range";

it("supports AVPlayer probes, open ranges and suffix ranges", () => {
  expect(byteRange("bytes=0-1", 100)).toEqual({ start: 0, end: 1 });
  expect(byteRange("bytes=20-", 100)).toEqual({ start: 20, end: 99 });
  expect(byteRange("bytes=-20", 100)).toEqual({ start: 80, end: 99 });
  expect(byteRange("bytes=0-200", 100)).toEqual({ start: 0, end: 99 });
});
it("rejects unsatisfiable, malformed and multipart ranges", () => {
  for (const value of [
    "bytes=100-",
    "bytes=2-1",
    "bytes=-0",
    "bytes=-",
    "bytes=0-1,3-4",
    "bytes=0-1junk",
  ]) {
    expect(byteRange(value, 100)).toBeNull();
  }
  expect(byteRange("bytes=0-1", 0)).toBeNull();
});
