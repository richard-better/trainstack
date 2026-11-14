import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { createAuthClient } from "better-auth/client";
import { deleteAccount, exportUrl } from "../hosted/apps/account/src/lib/account.ts";
import { mockApple } from "./helpers/apple.mjs";
import { readTar } from "./helpers/tar.mjs";
import { signInOnTheWeb } from "./helpers/web.mjs";
import { api, migrate, origin, startWorker } from "./helpers/worker.mjs";

const SAMPLE_RIDE = "apps/ride/RideKit/Sources/RideData/Resources/SampleRide.fit";

const apple = mockApple();
let worker;
let runtime;
let db;

before(
  async () => {
    worker = await startWorker({
      bindings: {
        NODE_ENV: "production",
        APPLE_SIGN_IN_KEY_ID: "TESTKEY123",
        APPLE_SIGN_IN_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "P-256" })
          .privateKey.export({ type: "pkcs8", format: "pem" })
          .toString(),
      },
      outboundService: (request) => apple.fetch(request),
    });
    runtime = worker.runtime;
    await migrate(runtime);
    db = await runtime.getD1Database("DB");
  },
  { timeout: 60_000 },
);

after(async () => {
  await worker?.dispose();
});

function webAuthClient(browser) {
  return createAuthClient({
    baseURL: api,
    fetchOptions: {
      customFetchImpl: async (url, init = {}) => {
        const headers = new Headers(init.headers);
        headers.set("Origin", origin);
        const response = await browser.visit(String(url), { ...init, headers });
        return new Response(await response.arrayBuffer(), {
          status: response.status,
          headers: Object.fromEntries(response.headers),
        });
      },
    },
  });
}

const userIdOf = async (email) =>
  (await db.prepare('SELECT id FROM "user" WHERE email = ?').bind(email).first())?.id;

test("the download link in settings gets the signed-in athlete's archive", async () => {
  const athlete = await signInOnTheWeb(runtime, apple);
  const bytes = await readFile(SAMPLE_RIDE);
  const { id } = await athlete.webApp.activities.upload({
    file: new File([bytes], "ride.fit"),
    source: "trainstack",
  });
  const download = await athlete.browser.visit(exportUrl(api), {
    headers: { "Sec-Fetch-Site": "same-site", "Sec-Fetch-Mode": "navigate" },
  });
  assert.equal(download.status, 200);
  const entries = await readTar(download.body);
  assert.ok(entries.some(({ path }) => path.endsWith(`/activities/${id}.fit`)));
  assert.ok(entries.some(({ path }) => path.endsWith("/README.md")));
});

test("deleting the account from settings deletes it", async () => {
  const athlete = await signInOnTheWeb(runtime, apple);
  const userId = await userIdOf(athlete.email);
  const outcome = await deleteAccount(() => webAuthClient(athlete.browser).deleteUser());
  assert.equal(outcome, "deleted");
  assert.equal(await userIdOf(athlete.email), undefined, `${userId} is gone`);
});

test("a session older than a day is asked to sign in again before deleting", async () => {
  const athlete = await signInOnTheWeb(runtime, apple);
  const userId = await userIdOf(athlete.email);
  await db
    .prepare("UPDATE session SET created_at = ? WHERE user_id = ?")
    .bind(Date.now() - 2 * 24 * 60 * 60 * 1000, userId)
    .run();
  const outcome = await deleteAccount(() => webAuthClient(athlete.browser).deleteUser());
  assert.equal(outcome, "sign_in_again");
  assert.equal(await userIdOf(athlete.email), userId);
});

test("deleting reports a failure when the API cannot be reached", async () => {
  const outcome = await deleteAccount(() => Promise.reject(new TypeError("Failed to fetch")));
  assert.equal(outcome, "failed");
  assert.equal(
    await deleteAccount(async () => ({ error: { status: 500 } })),
    "failed",
    "an answer that is not a deletion is a failure",
  );
});
