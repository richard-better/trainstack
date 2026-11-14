import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const wrongSpelling = "[Tt]rainStack";

function trackedPathsMatching(pattern) {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter((path) => new RegExp(pattern).test(path));
}

function trackedLinesMatching(pattern) {
  try {
    return execFileSync("git", ["grep", "-n", "-I", "-e", pattern, "--", "."], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch (failure) {
    if (failure.status === 1) return [];
    throw failure;
  }
}

test("the product is spelled Trainstack, with one capital, in every tracked file, names and code included", () => {
  assert.deepEqual(trackedLinesMatching(wrongSpelling), []);
});

test("no tracked file is named with any spelling but Trainstack", () => {
  assert.deepEqual(trackedPathsMatching(wrongSpelling), []);
});
