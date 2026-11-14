import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const marker = /^\s*(<{7}|\|{7}|>{7})(\s|$)/;

test("no tracked file keeps a merge conflict marker", () => {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(
      (file) =>
        file !== "" && !file.endsWith(".lock") && !/\.(png|jpe?g|fit|zip|gz|ico)$/i.test(file),
    );
  const found = files.flatMap((file) => {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return [];
    }
    return text
      .split("\n")
      .flatMap((line, index) => (marker.test(line) ? [`${file}:${index + 1}`] : []));
  });
  assert.deepEqual(found, []);
});
