import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

const oxlint = resolve("node_modules/.bin/oxlint");
const plugin = resolve("packages/config/lint/trainstack.mjs");

let directory;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "trainstack-no-comments-"));
  await writeFile(
    join(directory, ".oxlintrc.json"),
    JSON.stringify({
      jsPlugins: [plugin],
      categories: { correctness: "off" },
      rules: { "trainstack/no-comments": "error" },
    }),
  );
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function reportedLines(fileName, source) {
  const file = join(directory, fileName);
  await writeFile(file, source);
  const { stdout } = await promisify(execFile)(
    oxlint,
    ["--config", join(directory, ".oxlintrc.json"), "--format", "json", file],
    { cwd: directory },
  ).catch((failure) => failure);
  return JSON.parse(stdout)
    .diagnostics.filter((diagnostic) => diagnostic.code === "trainstack(no-comments)")
    .map((diagnostic) => diagnostic.labels[0].span.line);
}

test("line, block and JSDoc comments are reported", async () => {
  const source = [
    "// a line comment",
    "const answer = 42; // a trailing comment",
    "/* a block comment */",
    "/**",
    " * A JSDoc comment.",
    " */",
    "export const doubled = answer * 2;",
    "/// a triple-slash line that is not a reference",
    "",
  ].join("\n");
  assert.deepEqual(await reportedLines("comments.ts", source), [1, 2, 3, 4, 8]);
});

test("TypeScript references and the type-checking directives @ts-check and @ts-expect-error are allowed", async () => {
  const source = [
    "// @ts-check",
    '/// <reference types="node" />',
    "// @ts-expect-error the value is not a number",
    'export const notANumber: number = "text";',
    "",
  ].join("\n");
  assert.deepEqual(await reportedLines("directives.ts", source), []);
});

test("directives that switch type checking off are reported", async () => {
  const source = [
    "// @ts-nocheck",
    "// @ts-ignore",
    'export const notANumber: number = "text";',
    "",
  ].join("\n");
  assert.deepEqual(await reportedLines("switched-off.ts", source), [1, 2]);
});

test("comments in plain JavaScript modules are reported too", async () => {
  assert.deepEqual(await reportedLines("module.mjs", "export const one = 1; /* one */\n"), [1]);
});

test("no source file switches lint rules off, since that would let comments back in", async () => {
  const { stdout } = await promisify(execFile)("git", [
    "ls-files",
    "--",
    "*.ts",
    "*.tsx",
    "*.js",
    "*.mjs",
    "*.cjs",
    "*.astro",
  ]);
  const disableDirective = new RegExp(["(es|ox)lint", "-(disable|enable)"].join(""));
  const switchingOff = [];
  for (const file of stdout.split("\n").filter(Boolean)) {
    const source = await readFile(file, "utf8");
    if (disableDirective.test(source)) switchingOff.push(file);
  }
  assert.deepEqual(switchingOff, []);
});
