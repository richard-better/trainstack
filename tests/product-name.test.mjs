import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const wrongSpelling = "TrainStack(?![\\w+])";
const rideSwiftNotYetRenamed = "apps/ride/**/*.swift";

function trackedLinesMatching(pattern) {
  try {
    return execFileSync(
      "git",
      [
        "grep",
        "-n",
        "-I",
        "-P",
        "-e",
        pattern,
        "--",
        ".",
        ":(exclude)tests/product-name.test.mjs",
        `:(exclude,glob)${rideSwiftNotYetRenamed}`,
      ],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
  } catch (failure) {
    if (failure.status === 1) return [];
    throw failure;
  }
}

test("the product is spelled Trainstack, with one capital, in every tracked file", () => {
  assert.deepEqual(trackedLinesMatching(wrongSpelling), []);
});
