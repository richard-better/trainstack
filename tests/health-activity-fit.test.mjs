import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { migrate, rpcClient, startWorker } from "./helpers/worker.mjs";
import { mockApple } from "./helpers/apple.mjs";

const HEALTH_RUN = "apps/ride/RideKit/Tests/RideDataTests/Fixtures/health-run.fit";

let worker;
let runtime;
let db;
const apple = mockApple();

before(
  async () => {
    worker = await startWorker({ outboundService: apple.fetch });
    runtime = worker.runtime;
    await migrate(runtime);
    db = await runtime.getD1Database("DB");
  },
  { timeout: 60_000 },
);

after(async () => {
  await worker?.dispose();
});

async function analyseEverything() {
  for (let run = 0; run < 30; run++) {
    const due = await db
      .prepare("SELECT count(*) AS n FROM activity_analysis WHERE due = 1")
      .first();
    if (due.n === 0) return;
    const { outcome } = await (await runtime.getWorker()).scheduled({ cron: "* * * * *" });
    assert.equal(outcome, "ok");
  }
  assert.fail("activities were still due after thirty runs");
}

test("a Health workout's file from Ride is a run with its route, heart rate, pause and local day", async () => {
  const { token } = await apple.signIn(runtime, { email: `${crypto.randomUUID()}@example.com` });
  const client = rpcClient(runtime, { token });
  const uploaded = await client.activities.upload({
    file: new File([await readFile(HEALTH_RUN)], "health.fit"),
    source: "apple_health",
    sourceId: "8F2C1D0E-1111-4A2B-9C3D-4E5F60718293",
  });
  assert.equal(uploaded.sport, "running");
  assert.equal(uploaded.indoor, false);
  assert.deepEqual(uploaded.startedAt, new Date("2026-11-01T08:00:00Z"));
  assert.equal(uploaded.localDay, "2026-11-01");
  assert.equal(uploaded.localDaySource, "file");
  const { statistics } = uploaded;
  assert.equal(statistics.elapsed_s, 1800);
  assert.equal(statistics.timer_s, 1680, "the two minutes paused are not timer time");
  assert.equal(Math.round(statistics.distance_m), 5376);
  assert.equal(statistics.calories_kcal, 412);
  assert.ok(Math.abs(statistics.average_heart_rate_bpm - 140) < 3);

  await analyseEverything();
  const analysed = await client.activities.get({ id: uploaded.id });
  assert.equal(analysed.analysisError, null);
  assert.ok(analysed.route, "the route is drawn from the file's positions");
  assert.ok(analysed.statistics.ascent_m === 30, "the ascent Health measured");
  assert.ok(
    analysed.statistics.average_grade_adjusted_speed_mps > statistics.average_speed_mps,
    "an uphill run's grade-adjusted pace is faster than its pace",
  );
});
