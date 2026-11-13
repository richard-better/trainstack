import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

const oxlint = join(
  dirname(
    createRequire(resolve("node_modules/vite-plus/package.json")).resolve("oxlint/package.json"),
  ),
  "bin/oxlint",
);
const plugin = resolve("packages/config/lint/trainstack.mjs");

let directory;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "trainstack-relative-imports-"));
  await writeFile(
    join(directory, ".oxlintrc.json"),
    JSON.stringify({
      jsPlugins: [plugin],
      categories: { correctness: "off" },
      rules: { "trainstack/relative-import-extensions": "error" },
    }),
  );
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function reportedLines(source) {
  const file = join(directory, "index.ts");
  await writeFile(file, source);
  const { stdout } = await promisify(execFile)(
    oxlint,
    ["--config", join(directory, ".oxlintrc.json"), "--format", "json", file],
    { cwd: directory },
  ).catch((failure) => failure);
  return JSON.parse(stdout)
    .diagnostics.filter(
      (diagnostic) => diagnostic.code === "trainstack(relative-import-extensions)",
    )
    .map((diagnostic) => diagnostic.labels[0].span.line);
}

test("a relative import, re-export or dynamic import without an extension is reported", async () => {
  const source = [
    'import { settings } from "./settings";',
    'export * from "../statistics";',
    'export { zones } from "./zones/index";',
    'const later = await import("./later");',
    "",
  ].join("\n");
  assert.deepEqual(await reportedLines(source), [1, 2, 3, 4]);
});

test("relative imports with an extension, and package imports, are allowed", async () => {
  const source = [
    'import { settings } from "./settings.ts";',
    'export * from "../statistics.mjs";',
    'import data from "./data.json";',
    'import { z } from "zod";',
    'import { decodeFit } from "@trainstack/fit";',
    "",
  ].join("\n");
  assert.deepEqual(await reportedLines(source), []);
});

test("plain Node loads the contract's runtime values from its source", async () => {
  const contract = await import("../packages/contract/src/index.ts");
  assert.equal(contract.MAX_ACTIVITY_FILE_BYTES, 25 * 1024 * 1024);
});
