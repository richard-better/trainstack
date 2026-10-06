import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const hostedLicense = "FSL-1.1-ALv2";
const defaultLicense = "AGPL-3.0-only";

// Licenses that every part of the repository can depend on, and that a workspace outside
// hosted/ can choose instead of the default by adding its own LICENSE file.
const allowedDependencyLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
]);

// Packages allowed despite their license, with the reason.
const dependencyExceptions = [
  {
    name: /^@img\/sharp-libvips-/,
    license: "LGPL-3.0-or-later",
    reason: "libvips binary that sharp loads dynamically for Astro image builds",
  },
];

function isPermissive(license) {
  return allowedDependencyLicenses.has(license);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function kind({ directory, manifest }) {
  if (directory.startsWith("hosted/")) return "hosted";
  return isPermissive(manifest.license) ? "permissive" : "agpl";
}

const allowedKinds = {
  hosted: ["hosted", "permissive"],
  agpl: ["agpl", "permissive"],
  permissive: ["permissive"],
};

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function workspaces() {
  const root = await readJson("package.json");
  const directories = ["."];
  for (const pattern of root.workspaces.packages) {
    if (!pattern.endsWith("/*")) {
      directories.push(pattern);
      continue;
    }
    const parent = pattern.slice(0, -2);
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(join(parent, entry.name));
    }
  }
  return Promise.all(
    directories.map(async (directory) => ({
      directory,
      manifest: await readJson(join(directory, "package.json")),
    })),
  );
}

function dependencyNames(manifest) {
  return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap(
    (field) => Object.keys(manifest[field] ?? {}),
  );
}

test("workspace packages declare the license of their directory", async () => {
  for (const { directory, manifest } of await workspaces()) {
    const where = `${directory}/package.json`;
    if (directory.startsWith("hosted/")) {
      assert.equal(manifest.license, hostedLicense, where);
    } else if (directory !== "." && (await exists(join(directory, "LICENSE")))) {
      assert.ok(isPermissive(manifest.license), `${where}: ${manifest.license} is not permissive`);
    } else {
      assert.equal(manifest.license, defaultLicense, where);
    }
  }
});

test("workspace dependencies only point to compatible licenses", async () => {
  const all = await workspaces();
  const kinds = new Map(all.map((workspace) => [workspace.manifest.name, kind(workspace)]));
  for (const workspace of all) {
    const { manifest } = workspace;
    for (const name of dependencyNames(manifest).filter((name) => kinds.has(name))) {
      assert.ok(
        allowedKinds[kind(workspace)].includes(kinds.get(name)),
        `${manifest.name} (${kind(workspace)}) must not depend on ${name} (${kinds.get(name)})`,
      );
    }
  }
});

function licenseOf(manifest) {
  if (typeof manifest.license === "string") return manifest.license;
  if (manifest.license?.type) return manifest.license.type;
  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses.map((license) => license.type ?? license).join(" OR ");
  }
  return undefined;
}

function isAllowed(expression) {
  const alternatives = expression.replace(/[()]/g, "").split(" OR ");
  return alternatives.some((alternative) =>
    alternative.split(" AND ").every((license) => allowedDependencyLicenses.has(license.trim())),
  );
}

async function* installedPackages(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "@trainstack" || entry.isSymbolicLink()) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.name.startsWith("@")) {
      yield* installedPackages(path);
      continue;
    }
    try {
      yield { path, manifest: await readJson(join(path, "package.json")) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      continue;
    }
    yield* installedPackages(join(path, "node_modules"));
  }
}

test("third-party dependencies use licenses compatible with every part", async () => {
  const violations = [];
  let count = 0;
  for await (const { path, manifest } of installedPackages("node_modules")) {
    count++;
    const license = licenseOf(manifest);
    if (license && isAllowed(license)) continue;
    const exception = dependencyExceptions.find(
      (exception) => exception.name.test(manifest.name) && exception.license === license,
    );
    if (!exception) violations.push(`${manifest.name}@${manifest.version}: ${license} (${path})`);
  }
  assert.ok(count > 0, "run bun install before this test");
  assert.deepEqual(violations, []);
});
