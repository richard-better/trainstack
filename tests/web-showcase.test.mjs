import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { showcaseEntries } from "../hosted/apps/account/src/showcase/entries.ts";
import { RECORDINGS_PATH } from "../hosted/apps/account/src/showcase/recording.ts";
import { SHOWCASE_PATH } from "../hosted/apps/account/src/showcase/serve.ts";

const app = resolve("hosted/apps/account");
const routes = join(app, "src/routes");

async function routeIds() {
  const ids = ["__root__"];
  for (const name of await readdir(routes)) {
    const source = await readFile(join(routes, name), "utf8");
    const id = /createFileRoute\("([^"]+)"\)/.exec(source)?.[1];
    if (id) ids.push(id);
  }
  return ids;
}

test("every route of the web app has an entry in the showcase, and every entry is a route", async () => {
  const ids = await routeIds();
  const shown = new Set(showcaseEntries.map((entry) => entry.route));
  assert.deepEqual(
    ids.filter((id) => !shown.has(id)),
    [],
    "add these routes to hosted/apps/account/src/showcase/entries.ts",
  );
  assert.deepEqual(
    [...shown].filter((route) => !ids.includes(route)),
    [],
  );
});

test("showcase entries have their own ids, so each screenshot has its own file", () => {
  const ids = showcaseEntries.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
});

let built;

before(
  async () => {
    await mkdir(join(app, ".showcase"), { recursive: true });
    built = await mkdtemp(join(app, ".showcase", "production-"));
    await promisify(execFile)(resolve("node_modules/.bin/vp"), ["build", "--outDir", built], {
      cwd: app,
    });
  },
  { timeout: 180_000 },
);

after(async () => {
  if (built) await rm(built, { recursive: true, force: true });
});

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

test("the production build of the web app holds none of the showcase or its fixtures", async () => {
  const markers = [
    SHOWCASE_PATH,
    RECORDINGS_PATH,
    "recorded no answer",
    ...showcaseEntries
      .filter((entry) => entry.id.includes("-") && `/${entry.id}` !== entry.route)
      .map((entry) => `"${entry.id}"`),
  ];
  const found = [];
  for (const file of await filesUnder(built)) {
    const text = await readFile(file, "utf8");
    for (const marker of markers) if (text.includes(marker)) found.push(`${file}: ${marker}`);
  }
  assert.deepEqual(found, []);
});

test("the production web app answers the showcase and its recordings with not found", async () => {
  const server = (await import(pathToFileURL(join(built, "server/server.js")).href)).default;
  for (const path of [SHOWCASE_PATH, `${RECORDINGS_PATH}/athlete.json`]) {
    const response = await server.fetch(new Request(`https://account.trainstackhq.com${path}`));
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), /showcase/i, path);
  }
});

test("unknown production addresses return a designed 404 with a way back to Today", async () => {
  const server = (await import(pathToFileURL(join(built, "server/server.js")).href)).default;
  const response = await server.fetch(new Request("https://account.trainstackhq.com/no-such-page"));
  assert.equal(response.status, 404);
  const html = await response.text();
  assert.match(html, /Page not found/);
  assert.match(html, /href="\/"[^>]*>Back to Today/);
});
