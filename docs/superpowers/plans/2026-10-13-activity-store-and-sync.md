# Activity Store and Two-Way Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every ride on the server (original FIT in R2, parsed summary in D1), sync rides and
rider settings both ways between devices, and serve a Strava-shaped TrainStack API at `/v1`.

**Architecture:** New modules in `hosted/apps/api/src/` (`budget/`, `storage/`, `activities/`,
`sync/`) follow the `strava/` pattern: plain functions over the Drizzle database plus a Hono
route factory for binary FIT routes. JSON endpoints are contract-first oRPC procedures in
`packages/contract`, served by a second `OpenAPIHandler` mounted at `/v1`. Sync is a server
change log with per-field last-write-wins on hybrid logical clocks; the event log is written in
the same D1 batch as each change, guarded by SQLite's `changes()`.

**Tech Stack:** Cloudflare Workers, Hono, oRPC 1.15, zod 4, Drizzle 1.0 rc on D1, R2, Better
Auth 1.7.7, `@garmin/fitsdk`, Miniflare and `node --test` for tests, rolldown for bundling.

**Spec:** `docs/superpowers/specs/2026-10-13-activity-store-and-sync-design.md`

## Global Constraints

- Never use the em dash character in code, comments, docs or commit messages. Use "-" or rephrase.
- Commits use Scoped Commits: `<scope>: <short description>` (scopes here: `api`, `contract`, `db`,
  `infra`, `tests`, `docs`, or a comma-separated list). No co-author lines.
- Stage only the files the task changed. Never `git add -A`.
- FIT bodies are capped at 10 MB (`MAX_FIT_BYTES = 10 * 1024 * 1024`) and read with `readBody`.
- Clock format: `<ms:15 digits>.<counter:6 digits>.<deviceId>`, device ID `[A-Za-z0-9-]{1,64}`.
  Server-made clocks use device ID `server`. Clocks more than 10 minutes ahead are rejected.
- Events are kept 180 days. Tombstones are kept forever.
- At most 500 changes per push and 500 events per pull.
- Budgets per rider per 15 minutes: 60 uploads (`upload:<userId>`), 300 other calls
  (`api:<userId>`).
- Blob keys: `athletes/<userId>/activities/<sha256>.fit`, sha256 is 64 lowercase hex characters.
- Every query filters by the session's user ID. Another rider's activity is `404`.
- Comments explain why, in the plain style of `strava/index.ts`. Match its density.
- Tests: `bun run test` (that is `node --test tests/*.test.mjs`). Types: `bun run check-types`.
  Lint and format: `bun run check`.

## Review Focus

1. A device pushes a change for a ride it uploaded but whose upload has not finished: the change
   must come back `unknown_object`, not crash, so the device retries after uploading. (Task 7.)
2. A rider uploads a Garmin FIT with no power at all: the activity must store with null NP, kJ,
   IF and TSS, not 0 and not a 422. (Task 3.)
3. A device with no timezone (`timezone` omitted) uploads: `startDateLocal` must be the UTC time
   and stats must still count it. (Task 6.)
4. Two devices push the same field with the same millisecond but different device IDs: the larger
   device ID wins on both server and devices, deterministically. (Task 2 and Task 7.)
5. A rider deletes a zone change that set FTP: IF and TSS of rides on and after that day must
   revert to the previous FTP (or null). (Task 7.)

---

### Task 1: Shared rate budget and body reader

Preparatory refactor. Moves `spend`/`isSpent` and `readBody` out of `strava/` so the new modules
can use them, and renames the table to `rate_budget`.

**Files:**
- Create: `hosted/apps/api/src/budget/index.ts`
- Create: `hosted/apps/api/src/http.ts`
- Modify: `hosted/apps/api/src/db/schema/strava.ts` (remove `stravaBudget`)
- Create: `hosted/apps/api/src/db/schema/budget.ts`
- Modify: `hosted/apps/api/src/db/schema/index.ts`
- Modify: `hosted/apps/api/src/strava/index.ts`
- Modify: `tests/strava.test.mjs` (table name)
- Create: two generated migrations under `hosted/apps/api/src/db/migrations/`

**Interfaces:**
- Produces: `createBudget(database: () => Database): { spend(key: string, limit: number): Promise<boolean>; isSpent(key: string, limit: number): Promise<boolean> }`,
  `BUDGET_WINDOW_SECONDS = 900`, `readBody(request: Request, limit: number): Promise<Uint8Array | undefined>`,
  `MAX_FIT_BYTES`, table export `rateBudget`.

- [ ] **Step 1: Install dependencies**

Run: `bun install`
Expected: completes; `node_modules/` exists.

- [ ] **Step 2: Run the existing tests as a baseline**

Run: `bun run test`
Expected: all pass. If anything fails before you change code, stop and report it.

- [ ] **Step 3: Add the new budget table next to the old one**

Create `hosted/apps/api/src/db/schema/budget.ts`:

```ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * How much of a limit has been used in the current window. Keys name what is counted:
 * `athlete:<id>`, `user:<id>` and `app:exchange` for calls to Strava, `upload:<userId>` and
 * `api:<userId>` for the rider's own calls. Rows outlive what they count, so deleting and making
 * things again does not start a fresh budget.
 */
export const rateBudget = sqliteTable("rate_budget", {
  key: text("key").primaryKey(),
  /** When the current window began, in seconds since the epoch. */
  windowStart: integer("window_start").notNull(),
  used: integer("used").notNull(),
});
```

Add `export * from "./budget";` to `hosted/apps/api/src/db/schema/index.ts`. Leave
`stravaBudget` in place for now: drizzle-kit asks interactively whether a table was renamed when
one disappears and another appears in the same generate, and prompts cannot be answered here.

Run: `bun run db:generate`
Expected: a new migration folder whose `migration.sql` only creates `rate_budget`.

- [ ] **Step 4: Move the budget logic**

Create `hosted/apps/api/src/budget/index.ts`:

```ts
import { eq, sql } from "drizzle-orm";

import type { Database } from "../db";
import { rateBudget } from "../db/schema";

export const BUDGET_WINDOW_SECONDS = 15 * 60;

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Fixed-window limits kept in D1, shared by everything that counts calls. */
export function createBudget(database: () => Database) {
  /**
   * Takes one call from the budget `key` if there is any left, in a single statement so that
   * requests arriving together cannot all see room that is only there for one.
   */
  const spend = async (key: string, limit: number) => {
    const now = nowSeconds();
    const stale = sql`${rateBudget.windowStart} <= ${now - BUDGET_WINDOW_SECONDS}`;
    const spent = await database()
      .insert(rateBudget)
      .values({ key, windowStart: now, used: 1 })
      .onConflictDoUpdate({
        target: rateBudget.key,
        set: {
          used: sql`CASE WHEN ${stale} THEN 1 ELSE ${rateBudget.used} + 1 END`,
          windowStart: sql`CASE WHEN ${stale} THEN ${now} ELSE ${rateBudget.windowStart} END`,
        },
        setWhere: sql`${stale} OR ${rateBudget.used} < ${limit}`,
      })
      .returning({ key: rateBudget.key });
    return spent.length > 0;
  };

  /** Whether `key` has nothing left, to turn a request away before doing work for it. */
  const isSpent = async (key: string, limit: number) => {
    const row = await database().select().from(rateBudget).where(eq(rateBudget.key, key)).get();
    return !!row && row.used >= limit && row.windowStart > nowSeconds() - BUDGET_WINDOW_SECONDS;
  };

  return { spend, isSpent };
}
```

Create `hosted/apps/api/src/http.ts` by moving `readBody` (and its doc comment) verbatim from the
bottom of `strava/index.ts`, exported, plus the constant:

```ts
export const MAX_FIT_BYTES = 10 * 1024 * 1024;
```

In `strava/index.ts`:
- delete `MAX_FIT_BYTES`, `BUDGET_WINDOW_SECONDS`, the local `spend`, `isSpent` and `readBody`;
- import `{ createBudget }` from `../budget` and `{ MAX_FIT_BYTES, readBody }` from `../http`;
- inside `stravaRoutes`, add `const { spend, isSpent } = createBudget(deps.database);`;
- drop `stravaBudget` from the schema import.

- [ ] **Step 5: Drop the old table**

Delete the `stravaBudget` export and its doc comment from `db/schema/strava.ts`.

Run: `bun run db:generate`
Expected: a second new migration containing only `DROP TABLE \`strava_budget\`;`. Budgets are
15-minute windows, so losing the old rows is harmless.

Replace every `strava_budget` in `tests/strava.test.mjs` with `rate_budget`:

Run: `sd 'strava_budget' 'rate_budget' tests/strava.test.mjs`

- [ ] **Step 6: Verify**

Run: `bun run check-types && bun run test`
Expected: types clean, all tests pass, same count as Step 2.

- [ ] **Step 7: Commit**

```bash
git add hosted/apps/api/src/budget hosted/apps/api/src/http.ts hosted/apps/api/src/db/schema \
  hosted/apps/api/src/db/migrations hosted/apps/api/src/strava/index.ts tests/strava.test.mjs
git commit -m "api: share the rate budget and body reader beyond Strava"
```

---

### Task 2: Hybrid logical clocks and IDs

**Files:**
- Create: `packages/contract/src/sync.ts` (only `CLOCK_PATTERN` and `clockSchema` for now)
- Modify: `packages/contract/src/index.ts` (re-export)
- Create: `hosted/apps/api/src/sync/clock.ts`
- Create: `hosted/apps/api/src/ids.ts`
- Create: `tests/helpers/module.mjs`
- Test: `tests/clock.test.mjs`

**Interfaces:**
- Produces: `CLOCK_PATTERN: RegExp`, `clockSchema` (contract);
  `ZERO_CLOCK`, `MAX_CLOCK_SKEW_MS`, `formatClock(ms: number, counter: number, deviceId: string): string`,
  `parseClock(clock: string): { ms: number; counter: number; deviceId: string } | undefined`,
  `clockProblem(clock: string, now: number): "invalid" | "ahead" | undefined`,
  `serverClock(now: number): string` (api);
  `newId(prefix: string, now?: number): string` (api);
  `importModule(path: string): Promise<any>` (tests).

- [ ] **Step 1: Write the test helper that loads a TypeScript module**

Create `tests/helpers/module.mjs`:

```js
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { rolldown } from "rolldown";

/** Bundles one TypeScript module of the API and imports it, to test pure functions directly. */
export async function importModule(path) {
  const directory = await mkdtemp(join(tmpdir(), "trainstack-module-"));
  const bundle = await rolldown({ input: path, platform: "node", external: [/^node:/] });
  try {
    const file = join(directory, "module.mjs");
    await bundle.write({ file, format: "esm", codeSplitting: false });
    return await import(pathToFileURL(file).href);
  } finally {
    await bundle.close();
    await rm(directory, { recursive: true, force: true });
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/clock.test.mjs`:

```js
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { importModule } from "./helpers/module.mjs";

let clock;
let ids;
before(async () => {
  clock = await importModule("hosted/apps/api/src/sync/clock.ts");
  ids = await importModule("hosted/apps/api/src/ids.ts");
});

test("clocks are fixed width so string order is clock order", () => {
  const a = clock.formatClock(1_700_000_000_000, 0, "device-a");
  const b = clock.formatClock(1_700_000_000_000, 1, "device-a");
  const c = clock.formatClock(1_700_000_000_001, 0, "device-a");
  assert.equal(a, "001700000000000.000000.device-a");
  assert.ok(clock.ZERO_CLOCK < a && a < b && b < c);
});

test("the same moment from two devices is ordered by device ID", () => {
  const a = clock.formatClock(1_700_000_000_000, 0, "aaaa");
  const b = clock.formatClock(1_700_000_000_000, 0, "bbbb");
  assert.ok(a < b);
});

test("clocks parse back and malformed ones are refused", () => {
  assert.deepEqual(clock.parseClock("001700000000000.000002.device-a"), {
    ms: 1_700_000_000_000,
    counter: 2,
    deviceId: "device-a",
  });
  for (const bad of ["", "1700000000000.0.a", "001700000000000.000000.", "001700000000000.000000.a b"]) {
    assert.equal(clock.parseClock(bad), undefined, bad);
  }
});

test("a clock more than ten minutes ahead of the server is refused", () => {
  const now = 1_700_000_000_000;
  assert.equal(clock.clockProblem(clock.formatClock(now + 9 * 60_000, 0, "d"), now), undefined);
  assert.equal(clock.clockProblem(clock.formatClock(now + 11 * 60_000, 0, "d"), now), "ahead");
  assert.equal(clock.clockProblem("nonsense", now), "invalid");
});

test("server clocks use the server device ID", () => {
  assert.equal(clock.serverClock(1_700_000_000_000), "001700000000000.000000.server");
});

test("IDs carry their prefix and sort by time", () => {
  const first = ids.newId("act", 1_700_000_000_000);
  const second = ids.newId("act", 1_700_000_000_001);
  assert.match(first, /^act_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(first < second);
});
```

- [ ] **Step 3: Run to see it fail**

Run: `node --test tests/clock.test.mjs`
Expected: FAIL, the modules do not exist.

- [ ] **Step 4: Implement**

Create `packages/contract/src/sync.ts`:

```ts
import { z } from "zod";

/**
 * A hybrid logical clock: milliseconds, a counter for changes within one millisecond, and the
 * device that made it. Zero-padded so that comparing the strings compares the clocks.
 */
export const CLOCK_PATTERN = /^\d{15}\.\d{6}\.[A-Za-z0-9-]{1,64}$/;

export const clockSchema = z.string().regex(CLOCK_PATTERN);
```

Add `export * from "./sync";` to `packages/contract/src/index.ts`.

Create `hosted/apps/api/src/sync/clock.ts`:

```ts
import { CLOCK_PATTERN } from "@trainstack/contract";

/** Older than any clock a device can make, for fields nobody has edited. */
export const ZERO_CLOCK = "000000000000000.000000.0";
/** How far ahead of the server a device's clock may be before its changes are refused. */
export const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;

export function formatClock(ms: number, counter: number, deviceId: string) {
  return `${String(ms).padStart(15, "0")}.${String(counter).padStart(6, "0")}.${deviceId}`;
}

export function parseClock(clock: string) {
  if (!CLOCK_PATTERN.test(clock)) return undefined;
  const [ms, counter, deviceId] = clock.split(".");
  return { ms: Number(ms), counter: Number(counter), deviceId };
}

export function clockProblem(clock: string, now: number): "invalid" | "ahead" | undefined {
  const parsed = parseClock(clock);
  if (!parsed) return "invalid";
  return parsed.ms > now + MAX_CLOCK_SKEW_MS ? "ahead" : undefined;
}

/** A clock for an edit made on the server, such as through the API rather than a device. */
export const serverClock = (now: number) => formatClock(now, 0, "server");
```

`ZERO_CLOCK` ends in `0` rather than an empty device ID so it still matches the pattern when it
appears in a manifest.

Create `hosted/apps/api/src/ids.ts`:

```ts
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A prefixed ULID, such as `act_01J...`: unique, and sorted by when it was made. */
export function newId(prefix: string, now = Date.now()) {
  let time = "";
  for (let rest = now, i = 0; i < 10; i++, rest = Math.floor(rest / 32)) {
    time = ALPHABET[rest % 32] + time;
  }
  const random = crypto.getRandomValues(new Uint8Array(16));
  let tail = "";
  for (const byte of random) tail += ALPHABET[byte % 32];
  return `${prefix}_${time}${tail}`;
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test tests/clock.test.mjs tests/contract.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contract/src/sync.ts packages/contract/src/index.ts \
  hosted/apps/api/src/sync/clock.ts hosted/apps/api/src/ids.ts \
  tests/helpers/module.mjs tests/clock.test.mjs
git commit -m "api: add hybrid logical clocks and prefixed IDs for sync"
```

---

### Task 3: FIT parsing and ride metrics

**Files:**
- Modify: `hosted/apps/api/package.json`, root `package.json` (add `@garmin/fitsdk`)
- Create: `hosted/apps/api/src/activities/metrics.ts`
- Create: `hosted/apps/api/src/activities/fit.ts`
- Create: `tests/helpers/fit.mjs`
- Test: `tests/fit.test.mjs`

**Interfaces:**
- Produces:
  - `powerBySecond(records: { timestamp: Date; power?: number | null }[]): number[][]`
  - `normalizedPower(segments: number[][]): number | null` (unrounded)
  - `kilojoules(segments: number[][]): number | null`
  - `trainingLoad(np: number | null, ftp: number | null, movingTime: number): { intensityFactor: number; trainingStress: number } | null`
  - `class InvalidFit extends Error`
  - `type ParsedActivity = { source: "ride" | "import"; startDate: number; elapsedTime: number; movingTime: number; distance: number | null; averageWatts: number | null; maxWatts: number | null; weightedAverageWatts: number | null; kilojoules: number | null; deviceWatts: boolean; averageHeartrate: number | null; maxHeartrate: number | null; averageCadence: number | null; trainer: boolean; sportType: SportType; workoutName: string | null; fitFtp: number | null }`
  - `type ParsedLap = { startDate: string; elapsedTime: number; movingTime: number; distance: number | null; averageWatts: number | null; maxWatts: number | null; averageHeartrate: number | null; averageCadence: number | null }`
  - `parseFit(bytes: Uint8Array): ParsedActivity`, `parseLaps(bytes: Uint8Array): ParsedLap[]`
  - `makeFit(options): Uint8Array` (tests)

- [ ] **Step 1: Add the FIT SDK**

Run: `bun add --cwd hosted/apps/api @garmin/fitsdk && bun add --dev @garmin/fitsdk`
Expected: both `package.json` files list `@garmin/fitsdk`; `bun.lock` updated.

- [ ] **Step 2: Write the FIT fixture helper**

Create `tests/helpers/fit.mjs`:

```js
import { Encoder, Profile } from "@garmin/fitsdk";

/**
 * Builds an activity FIT file the way a head unit would, one record a second, so tests know
 * exactly what the server should compute from it.
 */
export function makeFit({
  manufacturer = "garmin",
  sport = "cycling",
  subSport = "indoorCycling",
  start = new Date("2026-03-01T07:00:00Z"),
  powers = [],
  heartRate,
  ftp,
  workoutName,
  laps = 1,
} = {}) {
  const encoder = new Encoder();
  const at = (seconds) => new Date(start.getTime() + seconds * 1000);
  const end = at(powers.length);
  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    type: "activity",
    manufacturer,
    product: 1,
    serialNumber: 1234,
    timeCreated: start,
  });
  if (ftp) encoder.onMesg(Profile.MesgNum.ZONES_TARGET, { functionalThresholdPower: ftp });
  if (workoutName) encoder.onMesg(Profile.MesgNum.WORKOUT, { wktName: workoutName, sport });
  powers.forEach((power, second) =>
    encoder.onMesg(Profile.MesgNum.RECORD, {
      timestamp: at(second),
      ...(power === null ? {} : { power }),
      ...(heartRate ? { heartRate } : {}),
    }),
  );
  const lapLength = Math.ceil(powers.length / laps);
  for (let lap = 0; lap < laps; lap++) {
    const from = lap * lapLength;
    const to = Math.min(powers.length, from + lapLength);
    encoder.onMesg(Profile.MesgNum.LAP, {
      messageIndex: lap,
      timestamp: at(to),
      startTime: at(from),
      totalElapsedTime: to - from,
      totalTimerTime: to - from,
      event: "lap",
      eventType: "stop",
    });
  }
  encoder.onMesg(Profile.MesgNum.SESSION, {
    messageIndex: 0,
    timestamp: end,
    startTime: start,
    totalElapsedTime: powers.length,
    totalTimerTime: powers.length,
    sport,
    subSport,
    event: "session",
    eventType: "stop",
  });
  encoder.onMesg(Profile.MesgNum.ACTIVITY, {
    timestamp: end,
    numSessions: 1,
    type: "manual",
    event: "activity",
    eventType: "stop",
  });
  return encoder.close();
}

export const repeat = (value, seconds) => Array.from({ length: seconds }, () => value);
```

If the encoder rejects enum strings such as `"garmin"`, pass the numbers from
`Profile.types` instead (`Profile.types.manufacturer` maps numbers to names); keep the option
names above.

- [ ] **Step 3: Write the failing tests**

Create `tests/fit.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, test } from "node:test";
import { makeFit, repeat } from "./helpers/fit.mjs";
import { importModule } from "./helpers/module.mjs";

let fit;
let metrics;
before(async () => {
  fit = await importModule("hosted/apps/api/src/activities/fit.ts");
  metrics = await importModule("hosted/apps/api/src/activities/metrics.ts");
});

const seconds = (powers, start = 0) =>
  powers.map((power, i) => ({ timestamp: new Date((start + i) * 1000), power }));

test("normalized power of a steady effort is that power", () => {
  const segments = metrics.powerBySecond(seconds(repeat(200, 60)));
  assert.equal(metrics.normalizedPower(segments), 200);
  assert.equal(metrics.kilojoules(segments), 12);
});

test("normalized power weighs hard surges above their average", () => {
  // Thirty seconds at 0 W then thirty at 400 W: the rolling averages climb 0, 13.3, ..., 400, so
  // NP is 400/30 * (sum of k^4 for k = 0..30 / 31)^(1/4).
  const np = metrics.normalizedPower(metrics.powerBySecond(seconds([...repeat(0, 30), ...repeat(400, 30)])));
  assert.ok(Math.abs(np - 270.79) < 0.05, `got ${np}`);
});

test("short gaps count as zero watts and long gaps split the ride", () => {
  const records = [...seconds(repeat(100, 40)), ...seconds(repeat(100, 40), 43)];
  assert.deepEqual(
    metrics.powerBySecond(records).map((segment) => segment.length),
    [83],
  );
  const split = [...seconds(repeat(100, 40)), ...seconds(repeat(100, 40), 100)];
  assert.deepEqual(metrics.powerBySecond(split).map((segment) => segment.length), [40, 40]);
});

test("under thirty seconds of power has no normalized power", () => {
  assert.equal(metrics.normalizedPower(metrics.powerBySecond(seconds(repeat(300, 29)))), null);
});

test("training load follows the TSS formula", () => {
  assert.deepEqual(metrics.trainingLoad(250, 250, 3600), { intensityFactor: 1, trainingStress: 100 });
  assert.equal(metrics.trainingLoad(null, 250, 3600), null);
  assert.equal(metrics.trainingLoad(200, null, 3600), null);
});

test("a Garmin indoor ride parses into Strava's summary fields", () => {
  const parsed = fit.parseFit(
    makeFit({ powers: repeat(200, 120), heartRate: 140, ftp: 250, workoutName: "Sweet spot" }),
  );
  assert.equal(parsed.source, "import");
  assert.equal(parsed.sportType, "VirtualRide");
  assert.equal(parsed.trainer, true);
  assert.equal(parsed.startDate, Date.parse("2026-03-01T07:00:00Z"));
  assert.equal(parsed.elapsedTime, 120);
  assert.equal(parsed.movingTime, 120);
  assert.equal(parsed.averageWatts, 200);
  assert.equal(parsed.maxWatts, 200);
  assert.equal(parsed.weightedAverageWatts, 200);
  assert.equal(parsed.kilojoules, 24);
  assert.equal(parsed.deviceWatts, true);
  assert.equal(parsed.averageHeartrate, 140);
  assert.equal(parsed.fitFtp, 250);
  assert.equal(parsed.workoutName, "Sweet spot");
});

test("an outdoor ride without power has no power metrics", () => {
  const parsed = fit.parseFit(makeFit({ subSport: "road", powers: repeat(null, 60), heartRate: 120 }));
  assert.equal(parsed.sportType, "Ride");
  assert.equal(parsed.trainer, false);
  assert.equal(parsed.deviceWatts, false);
  assert.equal(parsed.averageWatts, null);
  assert.equal(parsed.weightedAverageWatts, null);
  assert.equal(parsed.kilojoules, null);
});

test("Ride's own FIT files parse", async () => {
  const bytes = new Uint8Array(
    await readFile("apps/ride/RideKit/Sources/RideData/Resources/SampleRide.fit"),
  );
  const parsed = fit.parseFit(bytes);
  assert.equal(parsed.source, "ride");
  assert.equal(parsed.trainer, true);
  assert.ok(parsed.elapsedTime > 0);
  assert.ok(parsed.averageWatts > 0);
  assert.ok(parsed.weightedAverageWatts >= parsed.averageWatts);
});

test("laps come from the FIT file", () => {
  const laps = fit.parseLaps(makeFit({ powers: repeat(200, 120), laps: 2 }));
  assert.equal(laps.length, 2);
  assert.equal(laps[0].elapsedTime, 60);
  assert.equal(laps[1].startDate, "2026-03-01T07:01:00.000Z");
});

test("files that are not FIT, or have no session, are refused", () => {
  assert.throws(() => fit.parseFit(new Uint8Array([1, 2, 3, 4])), fit.InvalidFit);
  const noRecords = makeFit({ powers: [] });
  assert.throws(() => fit.parseFit(noRecords), fit.InvalidFit);
});
```

- [ ] **Step 4: Run to see it fail**

Run: `node --test tests/fit.test.mjs`
Expected: FAIL, modules missing.

- [ ] **Step 5: Implement the metrics**

Create `hosted/apps/api/src/activities/metrics.ts`:

```ts
export type PowerRecord = { timestamp: Date; power?: number | null };

/** A pause up to this long counts as soft-pedalling at 0 W; a longer one ends a stretch. */
const MAX_GAP_SECONDS = 5;
const WINDOW_SECONDS = 30;

/**
 * Power for each second of riding, in stretches split where recording stopped for longer than
 * a few seconds. Head units can write two records in a second; the later one wins.
 */
export function powerBySecond(records: PowerRecord[]): number[][] {
  const segments: number[][] = [];
  let current: number[] = [];
  let last: number | undefined;
  for (const record of records) {
    if (record.power == null) continue;
    const second = Math.floor(record.timestamp.getTime() / 1000);
    if (last !== undefined && second <= last) {
      current[current.length - 1] = record.power;
      continue;
    }
    if (last !== undefined && second - last > MAX_GAP_SECONDS) {
      segments.push(current);
      current = [];
    } else if (last !== undefined) {
      for (let missing = last + 1; missing < second; missing++) current.push(0);
    }
    current.push(record.power);
    last = second;
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/** Coggan's normalized power: the fourth-power mean of 30-second rolling averages. */
export function normalizedPower(segments: number[][]): number | null {
  let sum = 0;
  let count = 0;
  for (const segment of segments) {
    let window = 0;
    for (let i = 0; i < segment.length; i++) {
      window += segment[i];
      if (i >= WINDOW_SECONDS) window -= segment[i - WINDOW_SECONDS];
      if (i >= WINDOW_SECONDS - 1) {
        sum += (window / WINDOW_SECONDS) ** 4;
        count++;
      }
    }
  }
  return count > 0 ? (sum / count) ** 0.25 : null;
}

export function kilojoules(segments: number[][]): number | null {
  if (segments.length === 0) return null;
  let joules = 0;
  for (const segment of segments) for (const watts of segment) joules += watts;
  return joules / 1000;
}

/** IF and TSS. The same formula runs in SQL in `ftp.ts`; keep them identical. */
export function trainingLoad(np: number | null, ftp: number | null, movingTime: number) {
  if (!np || !ftp) return null;
  const intensityFactor = np / ftp;
  return {
    intensityFactor,
    trainingStress: (movingTime * np * np * 100) / (ftp * ftp * 3600),
  };
}
```

- [ ] **Step 6: Implement the parser**

Create `hosted/apps/api/src/activities/fit.ts`:

```ts
import { Decoder, Stream } from "@garmin/fitsdk";
import type { SportType } from "@trainstack/contract";

import { kilojoules, normalizedPower, powerBySecond } from "./metrics";

/** The file is not a FIT activity the server can read. The message says why, for the rider. */
export class InvalidFit extends Error {}

export type ParsedActivity = {
  source: "ride" | "import";
  startDate: number;
  elapsedTime: number;
  movingTime: number;
  distance: number | null;
  averageWatts: number | null;
  maxWatts: number | null;
  weightedAverageWatts: number | null;
  kilojoules: number | null;
  deviceWatts: boolean;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  averageCadence: number | null;
  trainer: boolean;
  sportType: SportType;
  workoutName: string | null;
  fitFtp: number | null;
};

export type ParsedLap = {
  startDate: string;
  elapsedTime: number;
  movingTime: number;
  distance: number | null;
  averageWatts: number | null;
  maxWatts: number | null;
  averageHeartrate: number | null;
  averageCadence: number | null;
};

type Message = Record<string, unknown>;

function decode(bytes: Uint8Array) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const stream = Stream.fromArrayBuffer(buffer as ArrayBuffer);
  if (!Decoder.isFIT(stream)) throw new InvalidFit("This is not a FIT file.");
  const decoder = new Decoder(stream);
  if (!decoder.checkIntegrity()) throw new InvalidFit("The FIT file is damaged.");
  const { messages, errors } = decoder.read({
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    applyScaleAndOffset: true,
    expandComponents: true,
  });
  if (errors.length > 0) throw new InvalidFit(String(errors[0]?.message ?? errors[0]));
  return messages as Record<string, Message[] | undefined>;
}

const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function mean(values: (number | null)[]) {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : null;
}

function max(values: (number | null)[]) {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? Math.max(...present) : null;
}

const INDOOR = new Set(["indoorCycling", "virtualActivity", "treadmill", "indoorRowing"]);

/** Strava's sport type for a FIT sport. Ride's own files are always trainer rides. */
function sportTypeOf(sport: unknown, trainer: boolean): SportType {
  switch (sport) {
    case "cycling":
      return trainer ? "VirtualRide" : "Ride";
    case "running":
      return trainer ? "VirtualRun" : "Run";
    case "rowing":
      return "Rowing";
    default:
      return "Workout";
  }
}

export function parseFit(bytes: Uint8Array): ParsedActivity {
  const messages = decode(bytes);
  const session = messages.sessionMesgs?.[0];
  const records = messages.recordMesgs ?? [];
  if (!session || records.length === 0) {
    throw new InvalidFit("The FIT file has no recorded activity.");
  }
  const startTime = session.startTime;
  if (!(startTime instanceof Date)) throw new InvalidFit("The FIT file has no start time.");
  const source = messages.fileIdMesgs?.[0]?.manufacturer === "development" ? "ride" : "import";
  const trainer = source === "ride" || INDOOR.has(String(session.subSport));

  const segments = powerBySecond(
    records.map((record) => ({
      timestamp: record.timestamp as Date,
      power: number(record.power),
    })),
  );
  const powers = records.map((record) => number(record.power));
  const np = normalizedPower(segments);
  const elapsedTime = Math.round(number(session.totalElapsedTime) ?? 0);

  return {
    source,
    startDate: startTime.getTime(),
    elapsedTime,
    movingTime: Math.round(number(session.totalTimerTime) ?? elapsedTime),
    distance: number(session.totalDistance),
    averageWatts: number(session.avgPower) ?? mean(powers),
    maxWatts: number(session.maxPower) ?? max(powers),
    weightedAverageWatts: np === null ? null : Math.round(np),
    kilojoules: kilojoules(segments),
    deviceWatts: segments.length > 0,
    averageHeartrate:
      number(session.avgHeartRate) ?? mean(records.map((record) => number(record.heartRate))),
    maxHeartrate:
      number(session.maxHeartRate) ?? max(records.map((record) => number(record.heartRate))),
    averageCadence:
      number(session.avgCadence) ?? mean(records.map((record) => number(record.cadence))),
    trainer,
    sportType: sportTypeOf(session.sport, trainer),
    workoutName: (messages.workoutMesgs?.[0]?.wktName as string | undefined) ?? null,
    fitFtp: number(messages.zonesTargetMesgs?.[0]?.functionalThresholdPower),
  };
}

export function parseLaps(bytes: Uint8Array): ParsedLap[] {
  return (decode(bytes).lapMesgs ?? []).map((lap) => {
    const elapsedTime = Math.round(number(lap.totalElapsedTime) ?? 0);
    return {
      startDate: (lap.startTime as Date).toISOString(),
      elapsedTime,
      movingTime: Math.round(number(lap.totalTimerTime) ?? elapsedTime),
      distance: number(lap.totalDistance),
      averageWatts: number(lap.avgPower),
      maxWatts: number(lap.maxPower),
      averageHeartrate: number(lap.avgHeartRate),
      averageCadence: number(lap.avgCadence),
    };
  });
}
```

This imports `SportType` from the contract, which Task 4 adds. To keep this task green on its
own, add the sport types to `packages/contract/src/activity.ts` now:

```ts
import { z } from "zod";

/** Strava's sport types, as many as TrainStack can record or import. */
export const sportTypes = ["Ride", "VirtualRide", "Run", "VirtualRun", "Rowing", "Workout"] as const;
export const sportTypeSchema = z.enum(sportTypes);
export type SportType = (typeof sportTypes)[number];
```

and `export * from "./activity";` in `packages/contract/src/index.ts`.

- [ ] **Step 7: Run the tests**

Run: `node --test tests/fit.test.mjs && bun run check-types`
Expected: PASS. If the SampleRide `weightedAverageWatts >= averageWatts` assertion fails, read
the sample's records before changing the assertion: NP below average power means the resampling
is wrong.

- [ ] **Step 8: Commit**

```bash
git add hosted/apps/api/package.json package.json bun.lock \
  hosted/apps/api/src/activities/metrics.ts hosted/apps/api/src/activities/fit.ts \
  packages/contract/src/activity.ts packages/contract/src/index.ts \
  tests/helpers/fit.mjs tests/fit.test.mjs
git commit -m "api: parse FIT activities and compute normalized power, kJ and TSS"
```

---

### Task 4: Contract for activities, athlete and sync

**Files:**
- Modify: `packages/contract/src/activity.ts`
- Modify: `packages/contract/src/sync.ts`
- Modify: `packages/contract/src/index.ts`
- Test: `tests/contract.test.mjs`

**Interfaces:**
- Produces (all exported from `@trainstack/contract`):
  - schemas `summaryActivitySchema`, `lapSchema`, `detailedActivitySchema`,
    `updatableActivitySchema`, `athleteSchema`, `totalsSchema`, `athleteStatsSchema`,
    `manifestActivitySchema`;
  - `settingsKinds`, `SettingsKind`, `zoneChangeValueSchema`, `ftpTestValueSchema`,
    `syncChangeSchema`, `SyncChange`, `changeResultSchema`, `ChangeResult`, `syncEventSchema`,
    `SyncEvent`, `settingsEntrySchema`, `manifestSchema`;
  - `appContract.activities.{list,get,update,delete}`, `appContract.athlete.{get,stats}`,
    `appContract.sync.{push,events,manifest}` with the routes below;
  - types `SummaryActivity`, `DetailedActivity`, `ManifestActivity`.

- [ ] **Step 1: Write the failing test**

Append to `tests/contract.test.mjs`:

```js
test("the sync contract refuses changes the server must never apply", async () => {
  const { importModule } = await import("./helpers/module.mjs");
  const { syncChangeSchema } = await importModule("packages/contract/src/index.ts");
  const clock = "001700000000000.000000.device-a";
  const ok = { changeId: "c1", objectType: "activity", objectId: "act_1", op: "update", clock };
  assert.ok(syncChangeSchema.safeParse({ ...ok, fields: { name: "Hill repeats" } }).success);
  assert.ok(!syncChangeSchema.safeParse({ ...ok, fields: {} }).success, "no fields");
  assert.ok(!syncChangeSchema.safeParse({ ...ok, fields: { distance: 1 } }).success, "read-only field");
  assert.ok(!syncChangeSchema.safeParse({ ...ok, fields: { name: "x" }, clock: "1" }).success);
  assert.ok(
    syncChangeSchema.safeParse({
      changeId: "c2",
      objectType: "settings",
      kind: "zone_change",
      entryId: "8E2B6A9C-0000-4000-8000-000000000001",
      op: "put",
      value: {
        day: "2026-03-01",
        changes: [{ type: "threshold", threshold: "ftp", scope: "all", value: 250 }],
      },
      clock,
    }).success,
  );
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/contract.test.mjs`
Expected: FAIL, `syncChangeSchema` undefined.

- [ ] **Step 3: Write the activity schemas**

Append to `packages/contract/src/activity.ts`:

```ts
/** Strava's SummaryActivity, camelCased, with TrainStack's training metrics added. */
export const summaryActivitySchema = z.object({
  id: z.string(),
  name: z.string(),
  sportType: sportTypeSchema,
  /** ISO 8601, UTC. */
  startDate: z.string(),
  /** Local wall-clock time without an offset, as `YYYY-MM-DDTHH:MM:SS`. */
  startDateLocal: z.string(),
  timezone: z.string().nullable(),
  elapsedTime: z.number().int(),
  movingTime: z.number().int(),
  distance: z.number().nullable(),
  averageWatts: z.number().nullable(),
  maxWatts: z.number().nullable(),
  weightedAverageWatts: z.number().int().nullable(),
  kilojoules: z.number().nullable(),
  deviceWatts: z.boolean(),
  averageHeartrate: z.number().nullable(),
  maxHeartrate: z.number().nullable(),
  averageCadence: z.number().nullable(),
  trainer: z.boolean(),
  hidden: z.boolean(),
  trainingStress: z.number().nullable(),
  intensityFactor: z.number().nullable(),
  workoutName: z.string().nullable(),
  fitSha256: z.string(),
});
export type SummaryActivity = z.infer<typeof summaryActivitySchema>;

export const lapSchema = z.object({
  startDate: z.string(),
  elapsedTime: z.number().int(),
  movingTime: z.number().int(),
  distance: z.number().nullable(),
  averageWatts: z.number().nullable(),
  maxWatts: z.number().nullable(),
  averageHeartrate: z.number().nullable(),
  averageCadence: z.number().nullable(),
});

export const detailedActivitySchema = summaryActivitySchema.extend({
  description: z.string().nullable(),
  laps: z.array(lapSchema),
});
export type DetailedActivity = z.infer<typeof detailedActivitySchema>;

/** What a rider can change about an activity, as Strava's UpdatableActivity. */
export const updatableActivitySchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    description: z.string().max(10_000).nullable(),
    sportType: sportTypeSchema,
    hidden: z.boolean(),
  })
  .partial()
  .strict()
  .refine((fields) => Object.keys(fields).length > 0, "Change at least one field.");

export const athleteSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable(),
  createdAt: z.string(),
});

export const totalsSchema = z.object({
  count: z.number().int(),
  distance: z.number(),
  movingTime: z.number().int(),
  elapsedTime: z.number().int(),
  kilojoules: z.number(),
  trainingStress: z.number(),
});

export const athleteStatsSchema = z.object({
  recentRideTotals: totalsSchema,
  ytdRideTotals: totalsSchema,
  allRideTotals: totalsSchema,
});

/** Every activity a device must know about, including deleted ones, with each field's clock. */
export const manifestActivitySchema = summaryActivitySchema.extend({
  description: z.string().nullable(),
  deleted: z.boolean(),
  clocks: z.object({
    name: z.string(),
    description: z.string(),
    sportType: z.string(),
    hidden: z.string(),
    existence: z.string(),
  }),
});
export type ManifestActivity = z.infer<typeof manifestActivitySchema>;
```

- [ ] **Step 4: Write the sync schemas**

Append to `packages/contract/src/sync.ts`:

```ts
import { sportTypeSchema, manifestActivitySchema } from "./activity";

export const settingsKinds = ["zone_change", "ftp_test", "preference"] as const;
export type SettingsKind = (typeof settingsKinds)[number];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * One entry of Ride's zone history: the changes that took effect on a local day. The server
 * reads the Default-scope FTP from it; other changes are kept as the app sent them.
 */
export const zoneChangeValueSchema = z.object({
  day,
  changes: z.array(
    z.union([
      z.object({
        type: z.literal("threshold"),
        threshold: z.string().min(1).max(64),
        scope: z.string().min(1).max(64),
        value: z.number().int().nullable(),
      }),
      z.looseObject({ type: z.enum(["choice", "ownZones", "listed"]) }),
    ]),
  ),
});

export const ftpTestValueSchema = z.object({
  date: z.iso.datetime(),
  kind: z.string().min(1).max(64),
  ftp: z.number().int().positive(),
  scope: z.string().min(1).max(64),
});

const changeId = z.string().min(1).max(64);
const entryId = z.string().min(1).max(128);

export const syncChangeSchema = z.union([
  z.strictObject({
    changeId,
    objectType: z.literal("activity"),
    objectId: z.string().min(1).max(64),
    op: z.literal("update"),
    fields: z
      .strictObject({
        name: z.string().trim().min(1).max(255),
        description: z.string().max(10_000).nullable(),
        sportType: sportTypeSchema,
        hidden: z.boolean(),
      })
      .partial()
      .refine((fields) => Object.keys(fields).length > 0),
    clock: clockSchema,
  }),
  z.strictObject({
    changeId,
    objectType: z.literal("activity"),
    objectId: z.string().min(1).max(64),
    op: z.literal("delete"),
    clock: clockSchema,
  }),
  z.strictObject({
    changeId,
    objectType: z.literal("settings"),
    kind: z.literal("zone_change"),
    entryId,
    op: z.literal("put"),
    value: zoneChangeValueSchema,
    clock: clockSchema,
  }),
  z.strictObject({
    changeId,
    objectType: z.literal("settings"),
    kind: z.literal("ftp_test"),
    entryId,
    op: z.literal("put"),
    value: ftpTestValueSchema,
    clock: clockSchema,
  }),
  z.strictObject({
    changeId,
    objectType: z.literal("settings"),
    kind: z.literal("preference"),
    entryId,
    op: z.literal("put"),
    value: z.json(),
    clock: clockSchema,
  }),
  z.strictObject({
    changeId,
    objectType: z.literal("settings"),
    kind: z.enum(settingsKinds),
    entryId,
    op: z.literal("delete"),
    clock: clockSchema,
  }),
]);
export type SyncChange = z.infer<typeof syncChangeSchema>;

export const changeResultSchema = z.object({
  changeId: z.string(),
  status: z.enum(["applied", "superseded", "unknown_object"]),
});
export type ChangeResult = z.infer<typeof changeResultSchema>;

/** A change as Strava's webhook events describe one, with its clock for last-write-wins. */
export const syncEventSchema = z.object({
  seq: z.number().int(),
  objectType: z.enum(["activity", "settings"]),
  /** An activity ID, or `<kind>:<entryId>` for settings. */
  objectId: z.string(),
  aspectType: z.enum(["create", "update", "delete"]),
  updates: z.record(z.string(), z.unknown()).nullable(),
  clock: z.string(),
  deviceId: z.string(),
  /** Milliseconds since the epoch. */
  eventTime: z.number().int(),
});
export type SyncEvent = z.infer<typeof syncEventSchema>;

export const settingsEntrySchema = z.object({
  kind: z.enum(settingsKinds),
  entryId: z.string(),
  value: z.unknown(),
  clock: z.string(),
  deleted: z.boolean(),
});

export const manifestSchema = z.object({
  cursor: z.number().int(),
  activities: z.array(manifestActivitySchema),
  settings: z.array(settingsEntrySchema),
  serverTime: z.number().int(),
});
```

Move the `import { z } from "zod";` line to the top of the file next to the new import.

- [ ] **Step 5: Add the procedures**

In `packages/contract/src/index.ts`, keep `userSchema`, `healthCheck` and `privateData`, add the
imports, and extend `appContract`:

```ts
import {
  athleteSchema,
  athleteStatsSchema,
  detailedActivitySchema,
  summaryActivitySchema,
  updatableActivitySchema,
} from "./activity";
import {
  changeResultSchema,
  manifestSchema,
  syncChangeSchema,
  syncEventSchema,
} from "./sync";

/** Errors every rider-only procedure can answer with. */
const owner = oc.errors({
  UNAUTHORIZED: {},
  RATE_LIMITED: { status: 429 },
});

const activities = {
  list: owner
    .route({ method: "GET", path: "/athlete/activities" })
    .input(
      z.object({
        /** Milliseconds since the epoch; only activities that started before. */
        before: z.coerce.number().int().optional(),
        after: z.coerce.number().int().optional(),
        cursor: z.string().max(128).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(30),
      }),
    )
    .output(
      z.object({ activities: z.array(summaryActivitySchema), next: z.string().nullable() }),
    ),
  get: owner
    .errors({ NOT_FOUND: {} })
    .route({ method: "GET", path: "/activities/{id}" })
    .input(z.object({ id: z.string() }))
    .output(detailedActivitySchema),
  update: owner
    .errors({ NOT_FOUND: {} })
    .route({ method: "PUT", path: "/activities/{id}" })
    .input(z.object({ id: z.string(), fields: updatableActivitySchema }))
    .output(detailedActivitySchema),
  delete: owner
    .errors({ NOT_FOUND: {} })
    .route({ method: "DELETE", path: "/activities/{id}", successStatus: 204 })
    .input(z.object({ id: z.string() }))
    .output(z.void()),
};

const athlete = {
  get: owner.route({ method: "GET", path: "/athlete" }).output(athleteSchema),
  stats: owner
    .route({ method: "GET", path: "/athlete/stats" })
    .input(z.object({ timezone: z.string().max(64).optional() }))
    .output(athleteStatsSchema),
};

const sync = {
  push: owner
    .errors({
      INVALID_CHANGES: {
        status: 400,
        data: z.object({
          problems: z.array(z.object({ index: z.number().int(), reason: z.string() })),
        }),
      },
    })
    .route({ method: "POST", path: "/sync/changes" })
    .input(
      z.object({
        deviceId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
        changes: z.array(syncChangeSchema).max(500),
      }),
    )
    .output(z.object({ results: z.array(changeResultSchema), serverTime: z.number().int() })),
  events: owner
    .errors({ CURSOR_EXPIRED: { status: 410 } })
    .route({ method: "GET", path: "/sync/events" })
    .input(
      z.object({
        after: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(500).default(500),
      }),
    )
    .output(
      z.object({
        events: z.array(syncEventSchema),
        next: z.number().int(),
        hasMore: z.boolean(),
        serverTime: z.number().int(),
      }),
    ),
  manifest: owner.route({ method: "GET", path: "/sync/manifest" }).output(manifestSchema),
};
```

Then add `activities, athlete, sync` to the `appContract` object.

The update input nests the editable fields under `fields` so that the path parameter `id`
cannot collide with them. Over OpenAPI the body is `{ "fields": { ... } }`.

- [ ] **Step 6: Keep the API compiling**

`implement(appContract)` requires a handler for every procedure. Until Tasks 7 to 9 replace
them, the new procedures answer `NOT_IMPLEMENTED`. In `hosted/apps/api/src/router.ts`:

```ts
/** Placeholder until the procedure is built; replaced in the same branch. */
const notYet = () => {
  throw new ORPCError("NOT_IMPLEMENTED");
};
```

and add to `api.router({...})`:

```ts
  activities: {
    list: api.activities.list.handler(notYet),
    get: api.activities.get.handler(notYet),
    update: api.activities.update.handler(notYet),
    delete: api.activities.delete.handler(notYet),
  },
  athlete: {
    get: api.athlete.get.handler(notYet),
    stats: api.athlete.stats.handler(notYet),
  },
  sync: {
    push: api.sync.push.handler(notYet),
    events: api.sync.events.handler(notYet),
    manifest: api.sync.manifest.handler(notYet),
  },
```

Task 9 deletes `notYet` once nothing uses it.

- [ ] **Step 7: Run the tests and types**

Run: `node --test tests/contract.test.mjs tests/worker.test.mjs && bun run check-types`
Expected: PASS. If the OpenAPI reference test in `worker.test.mjs` lists every path, extend its
expectation with the new paths rather than changing the contract.

- [ ] **Step 8: Commit**

```bash
git add packages/contract/src hosted/apps/api/src/router.ts tests/contract.test.mjs
git commit -m "contract: describe activities, athlete stats and sync"
```

---

### Task 5: Database tables

**Files:**
- Create: `hosted/apps/api/src/db/schema/activity.ts`
- Create: `hosted/apps/api/src/db/schema/sync.ts`
- Modify: `hosted/apps/api/src/db/schema/index.ts`
- Create: one generated migration
- Test: `tests/worker.test.mjs` (existing migration test covers it)

**Interfaces:**
- Produces: tables `activity` (export `activity`, row type `ActivityRow`),
  `settingsEntry`, `syncEvent`, `syncState` with the columns below.

- [ ] **Step 1: Write the schema**

Create `hosted/apps/api/src/db/schema/activity.ts`:

```ts
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
};

/**
 * A ride, parsed from the FIT file kept in R2. The file's SHA-256 is what devices know it by;
 * `id` is what the API calls it. Each editable field has its own clock, so edits to different
 * fields on different devices all survive. A deleted ride keeps its row as a tombstone so that a
 * device that missed the delete cannot bring it back.
 */
export const activity = sqliteTable(
  "activity",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fitSha256: text("fit_sha256").notNull(),
    source: text("source", { enum: ["ride", "import"] }).notNull(),
    externalId: text("external_id"),
    /** Milliseconds since the epoch. */
    startDate: integer("start_date").notNull(),
    timezone: text("timezone"),
    /** `YYYY-MM-DDTHH:MM:SS` in `timezone`, or UTC without one. */
    startDateLocal: text("start_date_local").notNull(),
    elapsedTime: integer("elapsed_time").notNull(),
    movingTime: integer("moving_time").notNull(),
    distance: real("distance"),
    averageWatts: real("average_watts"),
    maxWatts: real("max_watts"),
    weightedAverageWatts: integer("weighted_average_watts"),
    kilojoules: real("kilojoules"),
    deviceWatts: integer("device_watts", { mode: "boolean" }).notNull(),
    averageHeartrate: real("average_heartrate"),
    maxHeartrate: real("max_heartrate"),
    averageCadence: real("average_cadence"),
    trainer: integer("trainer", { mode: "boolean" }).notNull(),
    fitSportType: text("fit_sport_type").notNull(),
    workoutName: text("workout_name"),
    fitFtp: integer("fit_ftp"),
    /** The FTP IF and TSS were worked out with: the file's own, or the rider's on that day. */
    ftp: integer("ftp"),
    intensityFactor: real("intensity_factor"),
    trainingStress: real("training_stress"),
    name: text("name").notNull(),
    nameClock: text("name_clock").notNull(),
    description: text("description"),
    descriptionClock: text("description_clock").notNull(),
    sportType: text("sport_type").notNull(),
    sportTypeClock: text("sport_type_clock").notNull(),
    hidden: integer("hidden", { mode: "boolean" }).notNull(),
    hiddenClock: text("hidden_clock").notNull(),
    /** Milliseconds since the epoch; null while the ride exists. */
    deletedAt: integer("deleted_at"),
    /** The clock of the last delete or upload, whichever was later. */
    existenceClock: text("existence_clock").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("activity_user_fit_idx").on(table.userId, table.fitSha256),
    index("activity_user_start_idx").on(table.userId, table.startDate),
  ],
);

export type ActivityRow = typeof activity.$inferSelect;
```

Create `hosted/apps/api/src/db/schema/sync.ts`:

```ts
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

/** One of a rider's settings, synced as a whole: a zone change, an FTP test or a preference. */
export const settingsEntry = sqliteTable(
  "settings_entry",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["zone_change", "ftp_test", "preference"] }).notNull(),
    entryId: text("entry_id").notNull(),
    /** JSON; null once deleted. */
    value: text("value", { mode: "json" }),
    clock: text("clock").notNull(),
    /** Milliseconds since the epoch; null while the entry exists. */
    deletedAt: integer("deleted_at"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.kind, table.entryId] })],
);

/**
 * Every change to a rider's activities and settings, in order, for devices to catch up with.
 * `seq` is shared by all riders; each rider sees only their own, so gaps are expected.
 */
export const syncEvent = sqliteTable(
  "sync_event",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    objectType: text("object_type", { enum: ["activity", "settings"] }).notNull(),
    objectId: text("object_id").notNull(),
    aspectType: text("aspect_type", { enum: ["create", "update", "delete"] }).notNull(),
    updates: text("updates", { mode: "json" }),
    clock: text("clock").notNull(),
    deviceId: text("device_id").notNull(),
    /** Milliseconds since the epoch. */
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("sync_event_user_seq_idx").on(table.userId, table.seq),
    index("sync_event_user_created_idx").on(table.userId, table.createdAt),
  ],
);

/** How far a rider's event log has been pruned. A device behind this must start over. */
export const syncState = sqliteTable("sync_state", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  prunedThrough: integer("pruned_through").notNull(),
});
```

Add to `db/schema/index.ts`:

```ts
export * from "./activity";
export * from "./sync";
```

- [ ] **Step 2: Generate the migration**

Run: `bun run db:generate`
Expected: one new migration creating `activity`, `settings_entry`, `sync_event`, `sync_state`
and their indexes. Read the SQL: `seq` must be `integer PRIMARY KEY AUTOINCREMENT`, and every
`user_id` must reference `user(id)` with `ON DELETE cascade`.

- [ ] **Step 3: Verify**

Run: `bun run check-types; node --test tests/worker.test.mjs`
Expected: the worker tests pass (they apply every committed migration). Types may still fail
only in `router.ts` if Task 4's note was not followed.

- [ ] **Step 4: Commit**

```bash
git add hosted/apps/api/src/db/schema hosted/apps/api/src/db/migrations
git commit -m "db: add activity, settings and sync event tables"
```

---

### Task 6: Blob storage and the FIT upload and download routes

**Files:**
- Create: `hosted/apps/api/src/storage/index.ts`
- Create: `hosted/apps/api/src/activities/local-time.ts`
- Create: `hosted/apps/api/src/activities/ftp.ts`
- Create: `hosted/apps/api/src/activities/shape.ts`
- Create: `hosted/apps/api/src/activities/store.ts`
- Create: `hosted/apps/api/src/activities/routes.ts`
- Create: `hosted/apps/api/src/sync/events.ts` (only `eventIfChanged` for now)
- Modify: `hosted/apps/api/src/services.ts`, `hosted/apps/api/src/index.ts`
- Modify: `hosted/infra/alchemy.run.ts`
- Modify: `tests/helpers/worker.mjs`
- Create: `tests/helpers/riders.mjs`
- Test: `tests/ftp.test.mjs`, `tests/activities.test.mjs`

**Interfaces:**
- Consumes: `parseFit`, `InvalidFit`, `trainingLoad` (Task 3); `clockProblem`, `ZERO_CLOCK`
  (Task 2); `createBudget` (Task 1); `newId`; `activity`, `settingsEntry`, `syncEvent` (Task 5);
  `SummaryActivity` (Task 4).
- Produces:
  - `type Blobs = { put(key: string, bytes: Uint8Array): Promise<void>; get(key: string): Promise<Uint8Array | undefined>; delete(key: string): Promise<void>; deletePrefix(prefix: string): Promise<void> }`
  - `r2Blobs(bucket: R2Bucket): Blobs`, `fitKey(userId, sha256)`, `athletePrefix(userId)`
  - `isTimeZone(name: string): boolean`, `localTimestamp(ms: number, timeZone: string | null): string`, `defaultName(sportType: SportType, startDateLocal: string): string`
  - `type FtpChange = { day: string; ftp: number | null }`, `ftpChanges(values: unknown[]): FtpChange[]`, `ftpOn(changes: FtpChange[], day: string): number | null`, `ftpIntervals(changes: FtpChange[]): { from: string | null; to: string | null; ftp: number | null }[]`, `loadFtpChanges(db: Database, userId: string): Promise<FtpChange[]>`
  - `toSummary(row: ActivityRow): SummaryActivity`
  - `type NewEvent = { userId: string; objectType: "activity" | "settings"; objectId: string; aspectType: "create" | "update" | "delete"; updates: Record<string, unknown> | null; clock: string; deviceId: string; createdAt: number }`, `eventIfChanged(db: Database, event: NewEvent)` (a batch item)
  - `type UploadResult = { kind: "created" | "restored" | "existing" | "deleted"; row: ActivityRow }`, `storeUpload(db, blobs, input): Promise<UploadResult>`
  - `activityRoutes(deps: ActivityDeps): Hono`, mounted at `/v1`
  - `getBlobs(): Blobs` in `services.ts`
  - test helpers `signUp(runtime)`, `uploadFit(runtime, token, bytes, query)`, `sha256(bytes)`, `deviceClock(ms, counter, deviceId)`

- [ ] **Step 1: Bind an R2 bucket**

In `hosted/infra/alchemy.run.ts`, next to `db`:

```ts
/** Riders' original FIT files, under `athletes/<userId>/`. */
export const files = Cloudflare.R2.Bucket("files").pipe(RemovalPolicy.retain(production));
```

and in the `server` Worker's `env`, add `FILES: files,`. If `Cloudflare.R2.Bucket` is not the
name Alchemy exports, find the R2 bucket resource with
`ls node_modules/alchemy/src/Cloudflare` and use it the same way as `Cloudflare.D1.Database`.

In `tests/helpers/worker.mjs`, add `r2Buckets: ["FILES"],` next to `d1Databases: ["DB"],`.

- [ ] **Step 2: Write the FTP unit tests**

Create `tests/ftp.test.mjs`:

```js
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { importModule } from "./helpers/module.mjs";

let ftp;
before(async () => {
  ftp = await importModule("hosted/apps/api/src/activities/ftp.ts");
});

const entry = (day, changes) => ({ day, changes });
const setFtp = (value, scope = "all") => ({ type: "threshold", threshold: "ftp", scope, value });

test("the FTP on a day is the latest set on or before it", () => {
  const changes = ftp.ftpChanges([
    entry("2026-05-01", [setFtp(260)]),
    entry("2026-01-01", [setFtp(240)]),
  ]);
  assert.equal(ftp.ftpOn(changes, "2026-03-15"), 240);
  assert.equal(ftp.ftpOn(changes, "2026-05-01"), 260);
});

test("rides before the first zone change use that first day's zones", () => {
  const changes = ftp.ftpChanges([entry("2026-01-01", [setFtp(240)])]);
  assert.equal(ftp.ftpOn(changes, "2025-06-01"), 240);
});

test("when the first zone change set no FTP, earlier rides have none", () => {
  const changes = ftp.ftpChanges([
    entry("2026-01-01", [{ type: "threshold", threshold: "maxHeartRate", scope: "all", value: 190 }]),
    entry("2026-02-01", [setFtp(250)]),
  ]);
  assert.equal(ftp.ftpOn(changes, "2025-12-01"), null);
  assert.equal(ftp.ftpOn(changes, "2026-01-15"), null);
  assert.equal(ftp.ftpOn(changes, "2026-02-01"), 250);
});

test("sport-specific FTPs are ignored", () => {
  const changes = ftp.ftpChanges([entry("2026-01-01", [setFtp(300, "rowing")])]);
  assert.equal(ftp.ftpOn(changes, "2026-02-01"), null);
});

test("intervals cover every day exactly once", () => {
  const changes = ftp.ftpChanges([
    entry("2026-01-01", [setFtp(240)]),
    entry("2026-05-01", [setFtp(260)]),
  ]);
  assert.deepEqual(ftp.ftpIntervals(changes), [
    { from: null, to: "2026-05-01", ftp: 240 },
    { from: "2026-05-01", to: null, ftp: 260 },
  ]);
  assert.deepEqual(ftp.ftpIntervals([]), [{ from: null, to: null, ftp: null }]);
});
```

- [ ] **Step 3: Implement the FTP timeline**

Create `hosted/apps/api/src/activities/ftp.ts`:

```ts
import { zoneChangeValueSchema } from "@trainstack/contract";
import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "../db";
import { settingsEntry } from "../db/schema";

/** The Default-scope FTP from a local day on; null when that day's zones have none. */
export type FtpChange = { day: string; ftp: number | null };

/**
 * The FTP changes in a rider's zone history, oldest first. As in Ride's `ZoneHistory`, a ride
 * before the first entry uses that entry's zones, so when the first entry sets no FTP it starts
 * the timeline with none.
 */
export function ftpChanges(values: unknown[]): FtpChange[] {
  const entries = values
    .map((value) => zoneChangeValueSchema.safeParse(value))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
    .sort((a, b) => a.day.localeCompare(b.day));
  const changes: FtpChange[] = [];
  for (const entry of entries) {
    for (const change of entry.changes) {
      if (change.type === "threshold" && change.threshold === "ftp" && change.scope === "all") {
        changes.push({ day: entry.day, ftp: change.value });
      }
    }
  }
  if (entries.length > 0 && changes[0]?.day !== entries[0].day) {
    changes.unshift({ day: entries[0].day, ftp: null });
  }
  return changes;
}

export function ftpOn(changes: FtpChange[], day: string): number | null {
  let current = changes[0]?.ftp ?? null;
  for (const change of changes) {
    if (change.day > day) break;
    current = change.ftp;
  }
  return current;
}

/** The days each FTP covers, `from` inclusive and `to` exclusive, null meaning unbounded. */
export function ftpIntervals(changes: FtpChange[]) {
  if (changes.length === 0) return [{ from: null, to: null, ftp: null }];
  return changes.map((change, index) => ({
    from: index === 0 ? null : change.day,
    to: changes[index + 1]?.day ?? null,
    ftp: change.ftp,
  }));
}

export async function loadFtpChanges(db: Database, userId: string) {
  const rows = await db
    .select({ value: settingsEntry.value })
    .from(settingsEntry)
    .where(
      and(
        eq(settingsEntry.userId, userId),
        eq(settingsEntry.kind, "zone_change"),
        isNull(settingsEntry.deletedAt),
      ),
    );
  return ftpChanges(rows.map((row) => row.value));
}
```

Run: `node --test tests/ftp.test.mjs`
Expected: PASS.

- [ ] **Step 4: Write the failing upload tests**

Create `tests/helpers/riders.mjs`:

```js
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { api } from "./worker.mjs";

let riders = 0;

/** Signs a rider up with email and returns their bearer token. */
export async function signUp(runtime) {
  const email = `athlete${++riders}-${Date.now()}@example.com`;
  const response = await runtime.dispatchFetch(`${api}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://trainstackhq.com" },
    body: JSON.stringify({ name: `Athlete ${riders}`, email, password: "test-password-12345" }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.get("set-auth-token");
}

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const deviceClock = (ms, counter = 0, deviceId = "device-a") =>
  `${String(ms).padStart(15, "0")}.${String(counter).padStart(6, "0")}.${deviceId}`;

/** Calls the TrainStack API as a rider. JSON bodies are encoded. */
export function v1(runtime, token, path, { json, ...init } = {}) {
  return runtime.dispatchFetch(`${api}/v1${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(json === undefined ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
}

/** Uploads a FIT file the way Ride does. */
export function uploadFit(runtime, token, bytes, query = {}) {
  const params = new URLSearchParams({
    clock: deviceClock(Date.now()),
    deviceId: "device-a",
    ...query,
  });
  return v1(runtime, token, `/activities/fit/${query.sha256 ?? sha256(bytes)}?${params}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes,
  });
}
```

`URLSearchParams` will include a `sha256` key when the test overrides it; that extra query
parameter is ignored by the route.

Create `tests/activities.test.mjs`:

```js
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { makeFit, repeat } from "./helpers/fit.mjs";
import { deviceClock, sha256, signUp, uploadFit, v1 } from "./helpers/riders.mjs";
import { migrate, startWorker } from "./helpers/worker.mjs";

let worker;
let runtime;
let db;
let bucket;

before(
  async () => {
    worker = await startWorker();
    runtime = worker.runtime;
    await migrate(runtime);
    db = await runtime.getD1Database("DB");
    bucket = await runtime.getR2Bucket("FILES");
  },
  { timeout: 60_000 },
);

after(async () => {
  await worker?.dispose();
});

let rides = 0;
/** A ride no other test has uploaded, so each test starts with its own activity. */
const ride = (options = {}) =>
  makeFit({
    start: new Date(Date.parse("2026-03-01T07:00:00Z") + ++rides * 86_400_000),
    powers: repeat(200, 120),
    ...options,
  });

test("uploading a ride stores the file and the parsed activity", async () => {
  const token = await signUp(runtime);
  const bytes = ride({ ftp: 250 });
  const response = await uploadFit(runtime, token, bytes, { timezone: "Europe/Budapest" });
  assert.equal(response.status, 201, await response.clone().text());
  const activity = await response.json();
  assert.match(activity.id, /^act_/);
  assert.equal(activity.fitSha256, sha256(bytes));
  assert.equal(activity.sportType, "VirtualRide");
  assert.equal(activity.weightedAverageWatts, 200);
  assert.equal(activity.timezone, "Europe/Budapest");
  assert.equal(activity.startDateLocal.slice(11), "08:00:00");
  assert.equal(activity.name, "Morning Ride");
  assert.ok(Math.abs(activity.intensityFactor - 0.8) < 1e-9);
  assert.ok(Math.abs(activity.trainingStress - (120 * 200 * 0.8 * 100) / (250 * 3600)) < 1e-9);

  const userId = (await db.prepare("SELECT user_id FROM activity WHERE id = ?").bind(activity.id).first()).user_id;
  const stored = await bucket.get(`athletes/${userId}/activities/${activity.fitSha256}.fit`);
  assert.deepEqual(new Uint8Array(await stored.arrayBuffer()), bytes);

  const download = await v1(runtime, token, `/activities/${activity.id}/fit`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "application/vnd.ant.fit");
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
});

test("uploading the same ride again changes nothing", async () => {
  const token = await signUp(runtime);
  const bytes = ride();
  const first = await (await uploadFit(runtime, token, bytes)).json();
  const again = await uploadFit(runtime, token, bytes);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).id, first.id);
  const events = await db
    .prepare("SELECT count(*) AS n FROM sync_event WHERE object_id = ?")
    .bind(first.id)
    .first();
  assert.equal(events.n, 1);
});

test("a ride without a timezone uses UTC for its local time", async () => {
  const token = await signUp(runtime);
  const activity = await (await uploadFit(runtime, token, ride())).json();
  assert.equal(activity.timezone, null);
  assert.equal(activity.startDateLocal.slice(11), "07:00:00");
});

test("a body that does not match its hash is refused and nothing is stored", async () => {
  const token = await signUp(runtime);
  const bytes = ride();
  const response = await uploadFit(runtime, token, bytes, { sha256: "0".repeat(64) });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, "hash_mismatch");
  assert.equal((await bucket.list()).objects.filter((o) => o.key.endsWith(`${"0".repeat(64)}.fit`)).length, 0);
});

test("a file that is not a FIT activity is refused with the reason", async () => {
  const token = await signUp(runtime);
  const response = await uploadFit(runtime, token, new Uint8Array([1, 2, 3, 4, 5]));
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.error, "invalid_fit");
  assert.ok(body.message);
});

test("bad clocks, devices and timezones are refused before the body is read", async () => {
  const token = await signUp(runtime);
  const bytes = ride();
  for (const query of [
    { clock: "nonsense" },
    { clock: deviceClock(Date.now() + 11 * 60_000) },
    { deviceId: "has spaces" },
    { timezone: "Mars/Olympus_Mons" },
  ]) {
    const response = await uploadFit(runtime, token, bytes, query);
    assert.equal(response.status, 400, JSON.stringify(query));
  }
});

test("bodies over 10 MB are refused", async () => {
  const token = await signUp(runtime);
  const big = new Uint8Array(10 * 1024 * 1024 + 1);
  const response = await uploadFit(runtime, token, big);
  assert.equal(response.status, 413);
});

test("uploads need a session, and riders cannot read each other's files", async () => {
  const bytes = ride();
  assert.equal((await uploadFit(runtime, null, bytes)).status, 401);
  const owner = await signUp(runtime);
  const other = await signUp(runtime);
  const activity = await (await uploadFit(runtime, owner, bytes)).json();
  assert.equal((await v1(runtime, other, `/activities/${activity.id}/fit`)).status, 404);
  // The same file uploaded by another rider is their own activity.
  const theirs = await uploadFit(runtime, other, bytes);
  assert.equal(theirs.status, 201);
  assert.notEqual((await theirs.json()).id, activity.id);
});

test("a rider's uploads are limited to 60 every 15 minutes", async () => {
  const token = await signUp(runtime);
  const userId = (await db.prepare('SELECT id FROM "user" ORDER BY created_at DESC LIMIT 1').first()).id;
  await db
    .prepare("INSERT INTO rate_budget (key, window_start, used) VALUES (?, ?, 60)")
    .bind(`upload:${userId}`, Math.floor(Date.now() / 1000))
    .run();
  assert.equal((await uploadFit(runtime, token, ride())).status, 429);
});
```

Run: `node --test tests/activities.test.mjs`
Expected: FAIL (404s; nothing mounted).

- [ ] **Step 5: Implement storage**

Create `hosted/apps/api/src/storage/index.ts`:

```ts
/// <reference types="@cloudflare/workers-types" />

/** Where riders' files are kept. R2 on Workers; the interface keeps self-hosting open. */
export type Blobs = {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
};

export const athletePrefix = (userId: string) => `athletes/${userId}/`;
export const fitKey = (userId: string, sha256: string) =>
  `${athletePrefix(userId)}activities/${sha256}.fit`;

export function r2Blobs(bucket: R2Bucket): Blobs {
  return {
    async put(key, bytes) {
      await bucket.put(key, bytes, { httpMetadata: { contentType: "application/vnd.ant.fit" } });
    },
    async get(key) {
      const object = await bucket.get(key);
      return object ? new Uint8Array(await object.arrayBuffer()) : undefined;
    },
    async delete(key) {
      await bucket.delete(key);
    },
    async deletePrefix(prefix) {
      for (;;) {
        const listed = await bucket.list({ prefix, limit: 1000 });
        if (listed.objects.length === 0) return;
        await bucket.delete(listed.objects.map((object) => object.key));
      }
    },
  };
}
```

In `services.ts` add:

```ts
import { r2Blobs, type Blobs } from "./storage";

export function getBlobs(): Blobs {
  return r2Blobs(ENV.FILES);
}
```

- [ ] **Step 6: Implement local time and naming**

Create `hosted/apps/api/src/activities/local-time.ts`:

```ts
import type { SportType } from "@trainstack/contract";

export function isTimeZone(name: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock time in `timeZone` (UTC without one), as `YYYY-MM-DDTHH:MM:SS`. */
export function localTimestamp(ms: number, timeZone: string | null) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

const NOUNS: Record<SportType, string> = {
  Ride: "Ride",
  VirtualRide: "Ride",
  Run: "Run",
  VirtualRun: "Run",
  Rowing: "Row",
  Workout: "Workout",
};

/** Strava's name for an activity nobody has named: the part of the day and the sport. */
export function defaultName(sportType: SportType, startDateLocal: string) {
  const hour = Number(startDateLocal.slice(11, 13));
  const part =
    hour >= 5 && hour < 12 ? "Morning" : hour < 17 && hour >= 12 ? "Afternoon" : hour >= 17 && hour < 21 ? "Evening" : "Night";
  return `${part} ${NOUNS[sportType]}`;
}
```

- [ ] **Step 7: Implement the activity shape and events helper**

Create `hosted/apps/api/src/activities/shape.ts`:

```ts
import type { SportType, SummaryActivity } from "@trainstack/contract";

import type { ActivityRow } from "../db/schema";

export function toSummary(row: ActivityRow): SummaryActivity {
  return {
    id: row.id,
    name: row.name,
    sportType: row.sportType as SportType,
    startDate: new Date(row.startDate).toISOString(),
    startDateLocal: row.startDateLocal,
    timezone: row.timezone,
    elapsedTime: row.elapsedTime,
    movingTime: row.movingTime,
    distance: row.distance,
    averageWatts: row.averageWatts,
    maxWatts: row.maxWatts,
    weightedAverageWatts: row.weightedAverageWatts,
    kilojoules: row.kilojoules,
    deviceWatts: row.deviceWatts,
    averageHeartrate: row.averageHeartrate,
    maxHeartrate: row.maxHeartrate,
    averageCadence: row.averageCadence,
    trainer: row.trainer,
    hidden: row.hidden,
    trainingStress: row.trainingStress,
    intensityFactor: row.intensityFactor,
    workoutName: row.workoutName,
    fitSha256: row.fitSha256,
  };
}
```

Create `hosted/apps/api/src/sync/events.ts`:

```ts
import { sql } from "drizzle-orm";

import type { Database } from "../db";

export type NewEvent = {
  userId: string;
  objectType: "activity" | "settings";
  objectId: string;
  aspectType: "create" | "update" | "delete";
  updates: Record<string, unknown> | null;
  clock: string;
  deviceId: string;
  createdAt: number;
};

/**
 * Records an event only if the statement before it in the same batch changed a row. A batch is
 * one transaction on one connection, so `changes()` sees exactly that statement, and a change
 * that lost to a newer one leaves no event behind.
 */
export const eventIfChanged = (db: Database, event: NewEvent) =>
  db.run(sql`
    INSERT INTO sync_event
      (user_id, object_type, object_id, aspect_type, updates, clock, device_id, created_at)
    SELECT ${event.userId}, ${event.objectType}, ${event.objectId}, ${event.aspectType},
      ${event.updates === null ? null : JSON.stringify(event.updates)}, ${event.clock},
      ${event.deviceId}, ${event.createdAt}
    WHERE changes() > 0
  `);
```

- [ ] **Step 8: Implement storing an upload**

Create `hosted/apps/api/src/activities/store.ts`:

```ts
import { and, eq, lt } from "drizzle-orm";

import type { Database } from "../db";
import { activity, type ActivityRow } from "../db/schema";
import { newId } from "../ids";
import { type Blobs, fitKey } from "../storage";
import { eventIfChanged } from "../sync/events";
import { ZERO_CLOCK } from "../sync/clock";
import type { ParsedActivity } from "./fit";
import { ftpOn, loadFtpChanges } from "./ftp";
import { defaultName, localTimestamp } from "./local-time";
import { trainingLoad } from "./metrics";
import { toSummary } from "./shape";

export type UploadInput = {
  userId: string;
  sha256: string;
  fit: Uint8Array;
  parsed: ParsedActivity;
  clock: string;
  deviceId: string;
  timezone: string | null;
  externalId: string | null;
};

export type UploadResult = {
  /** `deleted`: the rider deleted this ride after the upload's clock, so it stays deleted. */
  kind: "created" | "restored" | "existing" | "deleted";
  row: ActivityRow;
};

const findByHash = (db: Database, userId: string, sha256: string) =>
  db
    .select()
    .from(activity)
    .where(and(eq(activity.userId, userId), eq(activity.fitSha256, sha256)))
    .get();

/**
 * Keeps an uploaded ride. The file is written before the row, so a row never points at a missing
 * file; a row that failed to write after its file leaves a file the retry overwrites. The file
 * is written even when the ride already exists, which mends one lost to a delete that raced a
 * re-upload.
 */
export async function storeUpload(
  db: Database,
  blobs: Blobs,
  input: UploadInput,
): Promise<UploadResult> {
  const now = Date.now();
  const existing = await findByHash(db, input.userId, input.sha256);
  if (existing && existing.deletedAt !== null && existing.existenceClock >= input.clock) {
    return { kind: "deleted", row: existing };
  }
  await blobs.put(fitKey(input.userId, input.sha256), input.fit);
  if (existing && existing.deletedAt === null) return { kind: "existing", row: existing };

  if (existing) {
    const restored = { ...existing, deletedAt: null, existenceClock: input.clock };
    await db.batch([
      db
        .update(activity)
        .set({ deletedAt: null, existenceClock: input.clock })
        .where(and(eq(activity.id, existing.id), lt(activity.existenceClock, input.clock))),
      eventIfChanged(db, {
        userId: input.userId,
        objectType: "activity",
        objectId: existing.id,
        aspectType: "create",
        updates: toSummary(restored),
        clock: input.clock,
        deviceId: input.deviceId,
        createdAt: now,
      }),
    ]);
    const row = (await findByHash(db, input.userId, input.sha256))!;
    return { kind: row.deletedAt === null ? "restored" : "deleted", row };
  }

  const { parsed } = input;
  const startDateLocal = localTimestamp(parsed.startDate, input.timezone);
  const ftp =
    parsed.fitFtp ?? ftpOn(await loadFtpChanges(db, input.userId), startDateLocal.slice(0, 10));
  const load = trainingLoad(parsed.weightedAverageWatts, ftp, parsed.movingTime);
  const row: ActivityRow = {
    id: newId("act", now),
    userId: input.userId,
    fitSha256: input.sha256,
    source: parsed.source,
    externalId: input.externalId,
    startDate: parsed.startDate,
    timezone: input.timezone,
    startDateLocal,
    elapsedTime: parsed.elapsedTime,
    movingTime: parsed.movingTime,
    distance: parsed.distance,
    averageWatts: parsed.averageWatts,
    maxWatts: parsed.maxWatts,
    weightedAverageWatts: parsed.weightedAverageWatts,
    kilojoules: parsed.kilojoules,
    deviceWatts: parsed.deviceWatts,
    averageHeartrate: parsed.averageHeartrate,
    maxHeartrate: parsed.maxHeartrate,
    averageCadence: parsed.averageCadence,
    trainer: parsed.trainer,
    fitSportType: parsed.sportType,
    workoutName: parsed.workoutName,
    fitFtp: parsed.fitFtp,
    ftp,
    intensityFactor: load?.intensityFactor ?? null,
    trainingStress: load?.trainingStress ?? null,
    name: parsed.workoutName ?? defaultName(parsed.sportType, startDateLocal),
    nameClock: ZERO_CLOCK,
    description: null,
    descriptionClock: ZERO_CLOCK,
    sportType: parsed.sportType,
    sportTypeClock: ZERO_CLOCK,
    hidden: false,
    hiddenClock: ZERO_CLOCK,
    deletedAt: null,
    existenceClock: input.clock,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
  try {
    await db.batch([
      db.insert(activity).values(row),
      eventIfChanged(db, {
        userId: input.userId,
        objectType: "activity",
        objectId: row.id,
        aspectType: "create",
        updates: toSummary(row),
        clock: input.clock,
        deviceId: input.deviceId,
        createdAt: now,
      }),
    ]);
  } catch (error) {
    // Two devices uploading the same ride at once: the other one made it.
    const winner = await findByHash(db, input.userId, input.sha256);
    if (winner) return { kind: "existing", row: winner };
    throw error;
  }
  return { kind: "created", row };
}
```

- [ ] **Step 9: Implement the routes**

Create `hosted/apps/api/src/activities/routes.ts`:

```ts
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

import { createBudget } from "../budget";
import type { Database } from "../db";
import { activity } from "../db/schema";
import { MAX_FIT_BYTES, readBody } from "../http";
import { type Blobs, fitKey } from "../storage";
import { clockProblem } from "../sync/clock";
import { InvalidFit, parseFit } from "./fit";
import { isTimeZone } from "./local-time";
import { toSummary } from "./shape";
import { storeUpload } from "./store";

export type ActivityDeps = {
  database: () => Database;
  blobs: () => Blobs;
  /** The signed-in rider's ID, if the request carries a session. */
  userId: (request: Request) => Promise<string | undefined>;
};

export const UPLOADS_PER_WINDOW = 60;
export const CALLS_PER_WINDOW = 300;
const SHA256 = /^[0-9a-f]{64}$/;
const DEVICE = /^[A-Za-z0-9-]{1,64}$/;

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The binary routes: FIT files in and out. Everything JSON is in the oRPC contract. */
export function activityRoutes(deps: ActivityDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();
  const { spend } = createBudget(deps.database);

  // Applied per route rather than to `*`: the sub-app is mounted at `/v1`, where the oRPC
  // procedures also live and answer with their own error shape.
  const signedIn = createMiddleware<{ Variables: { userId: string } }>(async (c, next) => {
    const userId = await deps.userId(c.req.raw);
    if (!userId) return c.json({ error: "unauthorized" }, 401);
    c.set("userId", userId);
    await next();
    c.header("Cache-Control", "no-store");
  });

  // The body is the ride's FIT file and the path its SHA-256, which is how every device knows
  // the ride, so sending it again is safe.
  app.put("/activities/fit/:sha256", signedIn, async (c) => {
    const userId = c.get("userId");
    const sha256 = c.req.param("sha256");
    const clock = c.req.query("clock") ?? "";
    const deviceId = c.req.query("deviceId") ?? "";
    const timezone = c.req.query("timezone") || null;
    const externalId = c.req.query("externalId")?.slice(0, 255) || null;
    if (!SHA256.test(sha256)) return c.json({ error: "invalid_request" }, 400);
    const problem = clockProblem(clock, Date.now());
    if (problem) return c.json({ error: `clock_${problem}` }, 400);
    if (!DEVICE.test(deviceId)) return c.json({ error: "invalid_device" }, 400);
    if (timezone && !isTimeZone(timezone)) return c.json({ error: "invalid_timezone" }, 400);
    if (Number(c.req.header("content-length") ?? 0) > MAX_FIT_BYTES) {
      return c.json({ error: "too_large" }, 413);
    }
    if (!(await spend(`upload:${userId}`, UPLOADS_PER_WINDOW))) {
      return c.json({ error: "rate_limited" }, 429);
    }
    const fit = await readBody(c.req.raw, MAX_FIT_BYTES);
    if (!fit) return c.json({ error: "too_large" }, 413);
    if (fit.byteLength === 0) return c.json({ error: "empty" }, 400);
    if ((await sha256Hex(fit)) !== sha256) return c.json({ error: "hash_mismatch" }, 422);
    let parsed;
    try {
      parsed = parseFit(fit);
    } catch (error) {
      if (error instanceof InvalidFit) {
        return c.json({ error: "invalid_fit", message: error.message }, 422);
      }
      throw error;
    }
    const result = await storeUpload(deps.database(), deps.blobs(), {
      userId,
      sha256,
      fit,
      parsed,
      clock,
      deviceId,
      timezone,
      externalId,
    });
    const status = { created: 201, restored: 201, existing: 200, deleted: 409 } as const;
    const body = toSummary(result.row);
    return result.kind === "deleted"
      ? c.json({ error: "deleted", activity: body }, 409)
      : c.json(body, status[result.kind]);
  });

  app.get("/activities/:id/fit", signedIn, async (c) => {
    const userId = c.get("userId");
    if (!(await spend(`api:${userId}`, CALLS_PER_WINDOW))) {
      return c.json({ error: "rate_limited" }, 429);
    }
    const row = await deps
      .database()
      .select({ sha256: activity.fitSha256 })
      .from(activity)
      .where(
        and(
          eq(activity.id, c.req.param("id")),
          eq(activity.userId, userId),
          isNull(activity.deletedAt),
        ),
      )
      .get();
    if (!row) return c.json({ error: "not_found" }, 404);
    const bytes = await deps.blobs().get(fitKey(userId, row.sha256));
    // A re-upload from any device that still has the file mends this.
    if (!bytes) return c.json({ error: "fit_missing" }, 404);
    return c.body(bytes, 200, { "Content-Type": "application/vnd.ant.fit" });
  });

  return app;
}
```

The upload test for the content-length precheck sends a real 10 MB + 1 body; the precheck turns
it away before the budget is spent.

- [ ] **Step 10: Mount the routes**

In `hosted/apps/api/src/index.ts`, after the `/strava` route:

```ts
app.route(
  "/v1",
  activityRoutes({
    database: getDb,
    blobs: getBlobs,
    userId: async (request) =>
      (await (await createAuth()).api.getSession({ headers: request.headers }))?.user.id,
  }),
);
```

Import `activityRoutes` from `./activities/routes` and `getBlobs` from `./services`. Extract the
`userId` lambda into a `const sessionUserId = async (request: Request) => ...` used by both
`/strava` and `/v1`.

In the `cors` options, set `allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]`.

- [ ] **Step 11: Run the tests**

Run: `node --test tests/activities.test.mjs tests/ftp.test.mjs && bun run check-types`
Expected: PASS (type check may fail only in `router.ts` if Task 4's note was skipped).

- [ ] **Step 12: Commit**

```bash
git add hosted/infra/alchemy.run.ts hosted/apps/api/src/storage hosted/apps/api/src/activities \
  hosted/apps/api/src/sync/events.ts hosted/apps/api/src/services.ts hosted/apps/api/src/index.ts \
  tests/helpers/worker.mjs tests/helpers/riders.mjs tests/ftp.test.mjs tests/activities.test.mjs
git commit -m "api, infra: keep uploaded rides in R2 and D1 and serve their FIT files"
```

---

### Task 7: Pushing changes, and the `/v1` JSON API

**Files:**
- Create: `hosted/apps/api/src/sync/apply.ts`
- Modify: `hosted/apps/api/src/activities/ftp.ts` (add `recomputeTraining`)
- Modify: `hosted/apps/api/src/router.ts`
- Modify: `hosted/apps/api/src/index.ts` (mount a second `OpenAPIHandler` at `/v1`)
- Test: `tests/sync.test.mjs`

**Interfaces:**
- Consumes: `eventIfChanged`, `NewEvent` (Task 6); `clockProblem`, `serverClock` (Task 2);
  `activity`, `settingsEntry` (Task 5); `SyncChange`, `ChangeResult` (Task 4);
  `fitKey`, `Blobs`, `getBlobs`; `createBudget`; `CALLS_PER_WINDOW`.
- Produces:
  - `applyChanges(db: Database, blobs: Blobs, userId: string, deviceId: string, changes: SyncChange[], now: number): Promise<ChangeResult[]>`
  - `recomputeTraining(db: Database, userId: string): Promise<void>`
  - oRPC procedure `sync.push` reachable at `POST /v1/sync/changes`.

- [ ] **Step 1: Write the failing sync tests**

Create `tests/sync.test.mjs`:

```js
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { makeFit, repeat } from "./helpers/fit.mjs";
import { deviceClock, signUp, uploadFit, v1 } from "./helpers/riders.mjs";
import { migrate, startWorker } from "./helpers/worker.mjs";

let worker;
let runtime;
let db;
let bucket;

before(
  async () => {
    worker = await startWorker();
    runtime = worker.runtime;
    await migrate(runtime);
    db = await runtime.getD1Database("DB");
    bucket = await runtime.getR2Bucket("FILES");
  },
  { timeout: 60_000 },
);

after(async () => {
  await worker?.dispose();
});

let rides = 0;
const ride = (options = {}) =>
  makeFit({
    start: new Date(Date.parse("2026-03-01T07:00:00Z") + ++rides * 86_400_000),
    powers: repeat(200, 3600),
    ...options,
  });

let changes = 0;
const update = (objectId, fields, clock) => ({
  changeId: `c${++changes}`,
  objectType: "activity",
  objectId,
  op: "update",
  fields,
  clock,
});
const remove = (objectId, clock) => ({
  changeId: `c${++changes}`,
  objectType: "activity",
  objectId,
  op: "delete",
  clock,
});

async function push(token, deviceId, list) {
  const response = await v1(runtime, token, "/sync/changes", {
    method: "POST",
    json: { deviceId, changes: list },
  });
  return { status: response.status, body: await response.json() };
}

const statuses = (result) => result.body.results.map((r) => r.status);
const row = (id) => db.prepare("SELECT * FROM activity WHERE id = ?").bind(id).first();
const eventsFor = (id) =>
  db.prepare("SELECT * FROM sync_event WHERE object_id = ? ORDER BY seq").bind(id).all();

/** A rider with one uploaded ride. */
async function riderWithRide(options) {
  const token = await signUp(runtime);
  const activity = await (await uploadFit(runtime, token, ride(options), {
    clock: deviceClock(Date.now() - 60_000),
  })).json();
  return { token, activity };
}

test("edits to different fields on two devices both survive", async () => {
  const { token, activity } = await riderWithRide();
  const t = Date.now();
  const a = await push(token, "device-a", [update(activity.id, { name: "Hill repeats" }, deviceClock(t, 0, "device-a"))]);
  const b = await push(token, "device-b", [update(activity.id, { sportType: "Ride" }, deviceClock(t - 1000, 0, "device-b"))]);
  assert.deepEqual(statuses(a), ["applied"]);
  assert.deepEqual(statuses(b), ["applied"]);
  const stored = await row(activity.id);
  assert.equal(stored.name, "Hill repeats");
  assert.equal(stored.sport_type, "Ride");
});

test("the later edit of a field wins, whichever arrives first", async () => {
  const { token, activity } = await riderWithRide();
  const t = Date.now();
  await push(token, "device-b", [update(activity.id, { name: "Newer" }, deviceClock(t, 0, "device-b"))]);
  const older = await push(token, "device-a", [update(activity.id, { name: "Older" }, deviceClock(t - 5000, 0, "device-a"))]);
  assert.deepEqual(statuses(older), ["superseded"]);
  assert.equal((await row(activity.id)).name, "Newer");
  const names = (await eventsFor(activity.id)).results
    .filter((e) => e.aspect_type === "update")
    .map((e) => JSON.parse(e.updates).name);
  assert.deepEqual(names, ["Newer"], "a superseded change leaves no event");
});

test("the same moment on two devices goes to the larger device ID", async () => {
  const { token, activity } = await riderWithRide();
  const t = Date.now();
  await push(token, "device-b", [update(activity.id, { name: "From B" }, deviceClock(t, 0, "device-b"))]);
  await push(token, "device-a", [update(activity.id, { name: "From A" }, deviceClock(t, 0, "device-a"))]);
  assert.equal((await row(activity.id)).name, "From B");
});

test("sending a change again is applied once", async () => {
  const { token, activity } = await riderWithRide();
  const change = update(activity.id, { hidden: true }, deviceClock(Date.now()));
  assert.deepEqual(statuses(await push(token, "device-a", [change])), ["applied"]);
  assert.deepEqual(statuses(await push(token, "device-a", [change])), ["applied"]);
  const updates = (await eventsFor(activity.id)).results.filter((e) => e.aspect_type === "update");
  assert.equal(updates.length, 1);
});

test("a delete beats earlier edits and later edits do not bring the ride back", async () => {
  const { token, activity } = await riderWithRide();
  const t = Date.now();
  await push(token, "device-a", [remove(activity.id, deviceClock(t))]);
  assert.ok((await row(activity.id)).deleted_at);
  const userId = (await row(activity.id)).user_id;
  assert.equal(await bucket.get(`athletes/${userId}/activities/${activity.fitSha256}.fit`), null);
  const late = await push(token, "device-b", [update(activity.id, { name: "Renamed" }, deviceClock(t + 1000, 0, "device-b"))]);
  assert.deepEqual(statuses(late), ["applied"]);
  const stored = await row(activity.id);
  assert.ok(stored.deleted_at, "still deleted");
  assert.equal(stored.name, "Renamed");
});

test("uploading a deleted ride again restores it with its newest edits", async () => {
  const token = await signUp(runtime);
  const bytes = ride();
  const t = Date.now();
  const activity = await (await uploadFit(runtime, token, bytes, { clock: deviceClock(t - 3000) })).json();
  await push(token, "device-a", [update(activity.id, { name: "Kept" }, deviceClock(t - 2000))]);
  await push(token, "device-a", [remove(activity.id, deviceClock(t - 1000))]);
  const stale = await uploadFit(runtime, token, bytes, { clock: deviceClock(t - 1500) });
  assert.equal(stale.status, 409, "an upload from before the delete stays deleted");
  const again = await uploadFit(runtime, token, bytes, { clock: deviceClock(t) });
  assert.equal(again.status, 201);
  const restored = await again.json();
  assert.equal(restored.id, activity.id);
  assert.equal(restored.name, "Kept");
  assert.equal((await row(activity.id)).deleted_at, null);
});

test("changes to rides the server does not have are reported, not fatal", async () => {
  const token = await signUp(runtime);
  const result = await push(token, "device-a", [update("act_missing", { name: "x" }, deviceClock(Date.now()))]);
  assert.equal(result.status, 200);
  assert.deepEqual(statuses(result), ["unknown_object"]);
});

test("another rider's ride is unknown", async () => {
  const { activity } = await riderWithRide();
  const other = await signUp(runtime);
  const result = await push(other, "device-a", [update(activity.id, { name: "Mine now" }, deviceClock(Date.now()))]);
  assert.deepEqual(statuses(result), ["unknown_object"]);
  assert.notEqual((await row(activity.id)).name, "Mine now");
});

test("a push with a clock too far ahead is refused whole", async () => {
  const { token, activity } = await riderWithRide();
  const result = await push(token, "device-a", [
    update(activity.id, { name: "Fine" }, deviceClock(Date.now())),
    update(activity.id, { name: "Future" }, deviceClock(Date.now() + 11 * 60_000)),
  ]);
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "INVALID_CHANGES");
  assert.deepEqual(result.body.data.problems, [{ index: 1, reason: "clock_ahead" }]);
  assert.notEqual((await row(activity.id)).name, "Fine");
});

test("malformed changes are refused", async () => {
  const token = await signUp(runtime);
  const result = await push(token, "device-a", [{ changeId: "x", objectType: "activity", objectId: "a", op: "update", fields: { distance: 1 }, clock: deviceClock(Date.now()) }]);
  assert.equal(result.status, 400);
});

test("pushing needs a session", async () => {
  const result = await push(null, "device-a", []);
  assert.equal(result.status, 401);
});

test("settings entries sync whole, with tombstones", async () => {
  const token = await signUp(runtime);
  const t = Date.now();
  const put = (value, clock) => ({
    changeId: `c${++changes}`,
    objectType: "settings",
    kind: "preference",
    entryId: "units",
    op: "put",
    value,
    clock,
  });
  await push(token, "device-a", [put("metric", deviceClock(t - 2000))]);
  await push(token, "device-b", [{ changeId: `c${++changes}`, objectType: "settings", kind: "preference", entryId: "units", op: "delete", clock: deviceClock(t - 1000, 0, "device-b") }]);
  const stale = await push(token, "device-a", [put("imperial", deviceClock(t - 1500))]);
  assert.deepEqual(statuses(stale), ["superseded"]);
  const entry = await db.prepare("SELECT * FROM settings_entry WHERE entry_id = 'units' AND clock LIKE ?").bind(`%device-b`).first();
  assert.ok(entry.deleted_at);
});

test("a zone change setting FTP recomputes IF and TSS, and removing it reverts them", async () => {
  const { token, activity } = await riderWithRide();
  assert.equal(activity.trainingStress, null, "no FTP yet");
  const day = activity.startDateLocal.slice(0, 10);
  const zone = (value, clock) => ({
    changeId: `c${++changes}`,
    objectType: "settings",
    kind: "zone_change",
    entryId: "zones-1",
    op: "put",
    value: { day, changes: [{ type: "threshold", threshold: "ftp", scope: "all", value }] },
    clock,
  });
  const t = Date.now();
  await push(token, "device-a", [zone(250, deviceClock(t - 2000))]);
  let stored = await row(activity.id);
  assert.equal(stored.ftp, 250);
  assert.ok(Math.abs(stored.training_stress - (3600 * 200 * 200 * 100) / (250 * 250 * 3600)) < 1e-9);
  await push(token, "device-a", [{ changeId: `c${++changes}`, objectType: "settings", kind: "zone_change", entryId: "zones-1", op: "delete", clock: deviceClock(t - 1000) }]);
  stored = await row(activity.id);
  assert.equal(stored.ftp, null);
  assert.equal(stored.training_stress, null);
});

test("a ride's own FTP is never replaced by the zone history", async () => {
  const { token, activity } = await riderWithRide({ ftp: 300 });
  await push(token, "device-a", [{
    changeId: `c${++changes}`,
    objectType: "settings",
    kind: "zone_change",
    entryId: "zones-2",
    op: "put",
    value: { day: "2020-01-01", changes: [{ type: "threshold", threshold: "ftp", scope: "all", value: 200 }] },
    clock: deviceClock(Date.now()),
  }]);
  assert.equal((await row(activity.id)).ftp, 300);
});
```

Run: `node --test tests/sync.test.mjs`
Expected: FAIL (`NOT_IMPLEMENTED` or 404).

- [ ] **Step 2: Implement recomputing IF and TSS**

Append to `hosted/apps/api/src/activities/ftp.ts`:

```ts
import { gte, lt, sql } from "drizzle-orm";
import { activity } from "../db/schema";

/**
 * Works IF and TSS out again for every ride that has no FTP of its own, after the rider's zone
 * history changed. One statement per span of days with the same FTP, in one batch. The formula
 * is `trainingLoad` in `metrics.ts`; keep them identical.
 */
export async function recomputeTraining(db: Database, userId: string) {
  const day = sql<string>`substr(${activity.startDateLocal}, 1, 10)`;
  const statements = ftpIntervals(await loadFtpChanges(db, userId)).map(({ from, to, ftp }) =>
    db
      .update(activity)
      .set({
        ftp,
        intensityFactor:
          ftp === null ? null : sql`${activity.weightedAverageWatts} * 1.0 / ${ftp}`,
        trainingStress:
          ftp === null
            ? null
            : sql`${activity.movingTime} * ${activity.weightedAverageWatts} * ${activity.weightedAverageWatts} * 100.0 / (${ftp} * ${ftp} * 3600.0)`,
      })
      .where(
        and(
          eq(activity.userId, userId),
          isNull(activity.fitFtp),
          from === null ? undefined : gte(day, from),
          to === null ? undefined : lt(day, to),
        ),
      ),
  );
  await db.batch(statements as [(typeof statements)[number], ...typeof statements]);
}
```

Merge the new imports into the existing import lines at the top of the file.

- [ ] **Step 3: Implement applying changes**

Create `hosted/apps/api/src/sync/apply.ts`:

```ts
import type { ChangeResult, SyncChange } from "@trainstack/contract";
import { and, eq, lt, or, sql, type SQL } from "drizzle-orm";

import { recomputeTraining } from "../activities/ftp";
import type { Database } from "../db";
import { activity, settingsEntry } from "../db/schema";
import { type Blobs, fitKey } from "../storage";
import { eventIfChanged } from "./events";

type ActivityUpdate = Extract<SyncChange, { objectType: "activity"; op: "update" }>;
type SettingsChange = Extract<SyncChange, { objectType: "settings" }>;

/** Each editable field, its column and its clock column. */
const FIELDS = {
  name: { value: activity.name, clock: activity.nameClock, clockKey: "nameClock" },
  description: {
    value: activity.description,
    clock: activity.descriptionClock,
    clockKey: "descriptionClock",
  },
  sportType: { value: activity.sportType, clock: activity.sportTypeClock, clockKey: "sportTypeClock" },
  hidden: { value: activity.hidden, clock: activity.hiddenClock, clockKey: "hiddenClock" },
} as const;

type Field = keyof typeof FIELDS;

/**
 * Applies a device's changes in order, each on its own: one losing to a newer change does not
 * stop the rest. A change whose clock is already stored was applied before, so it counts as
 * applied and writes nothing, which makes sending again safe.
 */
export async function applyChanges(
  db: Database,
  blobs: Blobs,
  userId: string,
  deviceId: string,
  changes: SyncChange[],
  now: number,
): Promise<ChangeResult[]> {
  const results: ChangeResult[] = [];
  let zonesChanged = false;
  for (const change of changes) {
    let status: ChangeResult["status"];
    if (change.objectType === "activity") {
      status =
        change.op === "update"
          ? await updateActivity(db, userId, deviceId, change, now)
          : await deleteActivity(db, blobs, userId, deviceId, change.objectId, change.clock, now);
    } else {
      status = await changeSettings(db, userId, deviceId, change, now);
      if (status === "applied" && change.kind === "zone_change") zonesChanged = true;
    }
    results.push({ changeId: change.changeId, status });
  }
  if (zonesChanged) await recomputeTraining(db, userId);
  return results;
}

const owned = (userId: string, id: string) =>
  and(eq(activity.id, id), eq(activity.userId, userId));

async function updateActivity(
  db: Database,
  userId: string,
  deviceId: string,
  change: ActivityUpdate,
  now: number,
): Promise<ChangeResult["status"]> {
  const current = await db.select().from(activity).where(owned(userId, change.objectId)).get();
  if (!current) return "unknown_object";
  const fields = Object.keys(change.fields) as Field[];
  const winning = fields.filter((field) => current[FIELDS[field].clockKey] < change.clock);
  if (winning.length === 0) {
    return fields.some((field) => current[FIELDS[field].clockKey] === change.clock)
      ? "applied"
      : "superseded";
  }
  // Each field is set only if its clock is still older when the statement runs, so a newer
  // change that landed since the read above is kept.
  const set: Record<string, SQL> = {};
  const updates: Record<string, unknown> = {};
  for (const field of winning) {
    const { value, clock } = FIELDS[field];
    const raw = change.fields[field];
    const bound = field === "hidden" ? (raw ? 1 : 0) : raw;
    const newer = sql`${clock} < ${change.clock}`;
    set[field] = sql`CASE WHEN ${newer} THEN ${bound} ELSE ${value} END`;
    set[FIELDS[field].clockKey] = sql`CASE WHEN ${newer} THEN ${change.clock} ELSE ${clock} END`;
    updates[field] = raw;
  }
  await db.batch([
    db
      .update(activity)
      .set(set)
      .where(
        and(
          owned(userId, change.objectId),
          or(...winning.map((field) => lt(FIELDS[field].clock, change.clock))),
        ),
      ),
    eventIfChanged(db, {
      userId,
      objectType: "activity",
      objectId: change.objectId,
      aspectType: "update",
      updates,
      clock: change.clock,
      deviceId,
      createdAt: now,
    }),
  ]);
  return "applied";
}

async function deleteActivity(
  db: Database,
  blobs: Blobs,
  userId: string,
  deviceId: string,
  id: string,
  clock: string,
  now: number,
): Promise<ChangeResult["status"]> {
  const current = await db
    .select({ existenceClock: activity.existenceClock, sha256: activity.fitSha256 })
    .from(activity)
    .where(owned(userId, id))
    .get();
  if (!current) return "unknown_object";
  if (current.existenceClock === clock) return "applied";
  if (current.existenceClock > clock) return "superseded";
  await db.batch([
    db
      .update(activity)
      .set({ deletedAt: now, existenceClock: clock })
      .where(and(owned(userId, id), lt(activity.existenceClock, clock))),
    eventIfChanged(db, {
      userId,
      objectType: "activity",
      objectId: id,
      aspectType: "delete",
      updates: null,
      clock,
      deviceId,
      createdAt: now,
    }),
  ]);
  // The rider asked for the ride to go, so the file goes too. A re-upload stores it again.
  await blobs.delete(fitKey(userId, current.sha256));
  return "applied";
}

async function changeSettings(
  db: Database,
  userId: string,
  deviceId: string,
  change: SettingsChange,
  now: number,
): Promise<ChangeResult["status"]> {
  const key = and(
    eq(settingsEntry.userId, userId),
    eq(settingsEntry.kind, change.kind),
    eq(settingsEntry.entryId, change.entryId),
  );
  const current = await db.select({ clock: settingsEntry.clock }).from(settingsEntry).where(key).get();
  if (current?.clock === change.clock) return "applied";
  if (current && current.clock > change.clock) return "superseded";
  const deleting = change.op === "delete";
  const value = deleting ? null : change.value;
  // A delete of an entry the server never saw still leaves a tombstone, so the entry cannot
  // arrive later from a device that is behind.
  await db.batch([
    db
      .insert(settingsEntry)
      .values({
        userId,
        kind: change.kind,
        entryId: change.entryId,
        value,
        clock: change.clock,
        deletedAt: deleting ? now : null,
      })
      .onConflictDoUpdate({
        target: [settingsEntry.userId, settingsEntry.kind, settingsEntry.entryId],
        set: { value, clock: change.clock, deletedAt: deleting ? now : null },
        setWhere: lt(settingsEntry.clock, change.clock),
      }),
    eventIfChanged(db, {
      userId,
      objectType: "settings",
      objectId: `${change.kind}:${change.entryId}`,
      aspectType: deleting ? "delete" : current ? "update" : "create",
      updates: deleting ? null : { value },
      clock: change.clock,
      deviceId,
      createdAt: now,
    }),
  ]);
  return "applied";
}
```

Status is reported as `applied` even if, between the read and the batch, a newer change won every
field. The device then holds a value the server does not, until it pulls the newer event, which
its own last-write-wins resolves. That is the protocol working as designed, not a lost update.

- [ ] **Step 4: Serve the contract at `/v1` and implement `sync.push`**

In `index.ts`, add after `apiHandler`:

```ts
/** The TrainStack API the apps use: REST paths from the contract, under `/v1`. */
export const v1Handler = new OpenAPIHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});
```

and inside the catch-all middleware, before the `/api-reference` attempt:

```ts
  const v1Result = await v1Handler.handle(c.req.raw, { prefix: "/v1", context });
  if (v1Result.matched) {
    return c.newResponse(v1Result.response.body, v1Result.response);
  }
```

In `router.ts`, add a budget middleware and the push handler:

```ts
import { clockProblem } from "./sync/clock";
import { applyChanges } from "./sync/apply";
import { createBudget } from "./budget";
import { CALLS_PER_WINDOW } from "./activities/routes";
import { getBlobs, getDb } from "./services";

const { spend } = createBudget(getDb);

/** The rider's share of the API: 300 calls every 15 minutes across everything. */
const withinBudget = api.middleware(async ({ context, next }) => {
  const userId = (context as { session: { user: { id: string } } }).session.user.id;
  if (!(await spend(`api:${userId}`, CALLS_PER_WINDOW))) {
    throw new ORPCError("RATE_LIMITED", { status: 429 });
  }
  return next();
});
```

```ts
  sync: {
    push: api.sync.push
      .use(requireAuth)
      .use(withinBudget)
      .handler(async ({ context, input, errors }) => {
        const now = Date.now();
        const problems = input.changes.flatMap((change, index) => {
          const problem = clockProblem(change.clock, now);
          return problem ? [{ index, reason: `clock_${problem}` }] : [];
        });
        if (problems.length > 0) throw errors.INVALID_CHANGES({ data: { problems } });
        const results = await applyChanges(
          getDb(),
          getBlobs(),
          context.session.user.id,
          input.deviceId,
          input.changes,
          now,
        );
        return { results, serverTime: Date.now() };
      }),
    events: api.sync.events.handler(notYet),
    manifest: api.sync.manifest.handler(notYet),
  },
```

Check how oRPC 1.15 types middleware context after `requireAuth`; if `withinBudget` can read
`context.session` without the cast, drop the cast.

- [ ] **Step 5: Run the tests**

Run: `node --test tests/sync.test.mjs tests/activities.test.mjs && bun run check-types`
Expected: PASS. If "a superseded change leaves no event" fails, `changes()` is not scoped to the
batch on this D1 build: replace `eventIfChanged` with an `INSERT ... SELECT ... WHERE EXISTS`
that re-checks the row's clock (`existence_clock = ?` or `<field>_clock = ?`), and keep the
same test.

- [ ] **Step 6: Commit**

```bash
git add hosted/apps/api/src/sync/apply.ts hosted/apps/api/src/activities/ftp.ts \
  hosted/apps/api/src/router.ts hosted/apps/api/src/index.ts tests/sync.test.mjs
git commit -m "api: apply synced ride and settings changes with per-field last-write-wins"
```

---

### Task 8: Pulling events, pruning and the manifest

**Files:**
- Modify: `hosted/apps/api/src/sync/events.ts`
- Modify: `hosted/apps/api/src/activities/shape.ts` (add `toManifestActivity`)
- Modify: `hosted/apps/api/src/router.ts`
- Test: `tests/sync.test.mjs` (append)

**Interfaces:**
- Produces: `EVENT_RETENTION_MS`, `class CursorExpired extends Error`,
  `pullEvents(db, userId, after, limit, now): Promise<{ events: SyncEvent[]; next: number; hasMore: boolean }>`,
  `manifest(db, userId): Promise<{ cursor: number; activities: ManifestActivity[]; settings: SettingsEntry[] }>`,
  `toManifestActivity(row: ActivityRow): ManifestActivity`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/sync.test.mjs`:

```js
const pull = async (token, after = 0, limit) => {
  const query = new URLSearchParams({ after: String(after), ...(limit ? { limit: String(limit) } : {}) });
  const response = await v1(runtime, token, `/sync/events?${query}`);
  return { status: response.status, body: await response.json() };
};

test("devices page through events in order", async () => {
  const { token, activity } = await riderWithRide();
  const t = Date.now();
  await push(token, "device-a", [
    update(activity.id, { name: "One" }, deviceClock(t - 3000)),
    update(activity.id, { name: "Two" }, deviceClock(t - 2000)),
    update(activity.id, { name: "Three" }, deviceClock(t - 1000)),
  ]);
  const first = await pull(token, 0, 2);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.events.map((e) => e.aspectType), ["create", "update"]);
  assert.equal(first.body.hasMore, true);
  assert.equal(first.body.events[0].updates.fitSha256, activity.fitSha256);
  const rest = await pull(token, first.body.next);
  assert.deepEqual(rest.body.events.map((e) => e.updates.name), ["Two", "Three"]);
  assert.equal(rest.body.hasMore, false);
  assert.equal(typeof rest.body.serverTime, "number");
});

test("riders only see their own events", async () => {
  const mine = await riderWithRide();
  const theirs = await riderWithRide();
  const events = (await pull(mine.token)).body.events;
  assert.ok(events.every((e) => e.objectId !== theirs.activity.id));
});

test("a cursor older than the kept events must start over from the manifest", async () => {
  const { token, activity } = await riderWithRide();
  const t = Date.now();
  await push(token, "device-a", [update(activity.id, { name: "Old news" }, deviceClock(t))]);
  const userId = (await row(activity.id)).user_id;
  await db
    .prepare("UPDATE sync_event SET created_at = created_at - ? WHERE user_id = ?")
    .bind(181 * 86_400_000, userId)
    .run();
  const expired = await pull(token, 0);
  assert.equal(expired.status, 410);
  assert.equal(expired.body.code, "CURSOR_EXPIRED");

  const manifest = await (await v1(runtime, token, "/sync/manifest")).json();
  const listed = manifest.activities.find((a) => a.id === activity.id);
  assert.equal(listed.name, "Old news");
  assert.equal(listed.clocks.name, deviceClock(t));
  assert.equal(listed.deleted, false);
  const resumed = await pull(token, manifest.cursor);
  assert.equal(resumed.status, 200);
  assert.deepEqual(resumed.body.events, []);
});

test("the manifest lists deleted rides and settings tombstones", async () => {
  const { token, activity } = await riderWithRide();
  const t = Date.now();
  await push(token, "device-a", [
    remove(activity.id, deviceClock(t)),
    { changeId: `c${++changes}`, objectType: "settings", kind: "ftp_test", entryId: "test-1", op: "delete", clock: deviceClock(t) },
  ]);
  const manifest = await (await v1(runtime, token, "/sync/manifest")).json();
  assert.equal(manifest.activities.find((a) => a.id === activity.id).deleted, true);
  const tombstone = manifest.settings.find((s) => s.entryId === "test-1");
  assert.equal(tombstone.deleted, true);
  assert.equal(tombstone.value, null);
});
```

Run: `node --test tests/sync.test.mjs`
Expected: the new tests FAIL.

- [ ] **Step 2: Implement events and the manifest**

Append to `hosted/apps/api/src/sync/events.ts`:

```ts
import type { ManifestActivity, SyncEvent } from "@trainstack/contract";
import { and, asc, eq, gt, max } from "drizzle-orm";

import { toManifestActivity } from "../activities/shape";
import { activity, settingsEntry, syncEvent, syncState } from "../db/schema";

/** How long events are kept. Devices further behind start over from the manifest. */
export const EVENT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

/** The device's cursor points at events that have been pruned. */
export class CursorExpired extends Error {}

/**
 * Drops the rider's events older than the retention, remembering the newest one dropped, in one
 * batch, so a cursor is never quietly behind a gap.
 */
async function prune(db: Database, userId: string, now: number) {
  const cutoff = now - EVENT_RETENTION_MS;
  await db.batch([
    db.run(sql`
      INSERT INTO sync_state (user_id, pruned_through)
      SELECT ${userId}, max(seq) FROM sync_event
      WHERE user_id = ${userId} AND created_at < ${cutoff}
      HAVING max(seq) IS NOT NULL
      ON CONFLICT (user_id) DO UPDATE SET
        pruned_through = max(pruned_through, excluded.pruned_through)
    `),
    db.run(sql`DELETE FROM sync_event WHERE user_id = ${userId} AND created_at < ${cutoff}`),
  ]);
}

export async function pullEvents(
  db: Database,
  userId: string,
  after: number,
  limit: number,
  now: number,
) {
  await prune(db, userId, now);
  const state = await db.select().from(syncState).where(eq(syncState.userId, userId)).get();
  if (state && after < state.prunedThrough) throw new CursorExpired();
  const rows = await db
    .select()
    .from(syncEvent)
    .where(and(eq(syncEvent.userId, userId), gt(syncEvent.seq, after)))
    .orderBy(asc(syncEvent.seq))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const events: SyncEvent[] = page.map((row) => ({
    seq: row.seq,
    objectType: row.objectType,
    objectId: row.objectId,
    aspectType: row.aspectType,
    updates: row.updates as Record<string, unknown> | null,
    clock: row.clock,
    deviceId: row.deviceId,
    eventTime: row.createdAt,
  }));
  return { events, next: page.at(-1)?.seq ?? after, hasMore: rows.length > limit };
}

/**
 * Everything a device needs to start over. The cursor is read first: an event that lands while
 * the rows are read is then seen twice, which last-write-wins makes harmless, rather than not at
 * all.
 */
export async function manifest(db: Database, userId: string) {
  const top = await db
    .select({ seq: max(syncEvent.seq) })
    .from(syncEvent)
    .where(eq(syncEvent.userId, userId))
    .get();
  const state = await db.select().from(syncState).where(eq(syncState.userId, userId)).get();
  const activities = await db.select().from(activity).where(eq(activity.userId, userId));
  const settings = await db.select().from(settingsEntry).where(eq(settingsEntry.userId, userId));
  return {
    cursor: Math.max(top?.seq ?? 0, state?.prunedThrough ?? 0),
    activities: activities.map(toManifestActivity) as ManifestActivity[],
    settings: settings.map((entry) => ({
      kind: entry.kind,
      entryId: entry.entryId,
      value: entry.value,
      clock: entry.clock,
      deleted: entry.deletedAt !== null,
    })),
  };
}
```

Merge imports at the top of the file.

Append to `activities/shape.ts`:

```ts
import type { ManifestActivity } from "@trainstack/contract";

export function toManifestActivity(row: ActivityRow): ManifestActivity {
  return {
    ...toSummary(row),
    description: row.description,
    deleted: row.deletedAt !== null,
    clocks: {
      name: row.nameClock,
      description: row.descriptionClock,
      sportType: row.sportTypeClock,
      hidden: row.hiddenClock,
      existence: row.existenceClock,
    },
  };
}
```

- [ ] **Step 3: Wire the handlers**

In `router.ts`:

```ts
    events: api.sync.events
      .use(requireAuth)
      .use(withinBudget)
      .handler(async ({ context, input, errors }) => {
        try {
          const page = await pullEvents(getDb(), context.session.user.id, input.after, input.limit, Date.now());
          return { ...page, serverTime: Date.now() };
        } catch (error) {
          if (error instanceof CursorExpired) throw errors.CURSOR_EXPIRED();
          throw error;
        }
      }),
    manifest: api.sync.manifest
      .use(requireAuth)
      .use(withinBudget)
      .handler(async ({ context }) => ({
        ...(await manifest(getDb(), context.session.user.id)),
        serverTime: Date.now(),
      })),
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/sync.test.mjs && bun run check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hosted/apps/api/src/sync/events.ts hosted/apps/api/src/activities/shape.ts \
  hosted/apps/api/src/router.ts tests/sync.test.mjs
git commit -m "api: let devices pull sync events and recover from a manifest"
```

---

### Task 9: Activities and athlete API

**Files:**
- Modify: `hosted/apps/api/src/activities/store.ts` (queries)
- Modify: `hosted/apps/api/src/router.ts`
- Test: `tests/activities.test.mjs` (append)

**Interfaces:**
- Consumes: `applyChanges`, `serverClock`, `toSummary`, `parseLaps`, `fitKey`, `getBlobs`.
- Produces: `listActivities(db, userId, { before?, after?, cursor?, limit }): Promise<{ activities: SummaryActivity[]; next: string | null }>`,
  `findLiveActivity(db, userId, id): Promise<ActivityRow | undefined>`,
  `athleteStats(db, userId, timezone: string | null, now: number): Promise<AthleteStats>`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/activities.test.mjs`:

```js
test("the activity list pages newest first and skips deleted rides", async () => {
  const token = await signUp(runtime);
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await (await uploadFit(runtime, token, ride())).json()).id);
  const deleted = await v1(runtime, token, `/activities/${ids[1]}`, { method: "DELETE" });
  assert.equal(deleted.status, 204);
  const first = await (await v1(runtime, token, "/athlete/activities?limit=1")).json();
  assert.deepEqual(first.activities.map((a) => a.id), [ids[2]]);
  const second = await (await v1(runtime, token, `/athlete/activities?limit=1&cursor=${encodeURIComponent(first.next)}`)).json();
  assert.deepEqual(second.activities.map((a) => a.id), [ids[0]]);
  assert.equal(second.next, null);
});

test("an activity's detail has its laps and description", async () => {
  const token = await signUp(runtime);
  const created = await (await uploadFit(runtime, token, ride({ laps: 3 }))).json();
  const updated = await v1(runtime, token, `/activities/${created.id}`, {
    method: "PUT",
    json: { fields: { description: "Legs felt good", hidden: true } },
  });
  assert.equal(updated.status, 200, await updated.clone().text());
  const detail = await (await v1(runtime, token, `/activities/${created.id}`)).json();
  assert.equal(detail.description, "Legs felt good");
  assert.equal(detail.hidden, true);
  assert.equal(detail.laps.length, 3);
  const events = await db
    .prepare("SELECT device_id, aspect_type FROM sync_event WHERE object_id = ? ORDER BY seq")
    .bind(created.id)
    .all();
  assert.deepEqual(events.results.at(-1), { device_id: "server", aspect_type: "update" });
});

test("another rider's activity is not found", async () => {
  const owner = await signUp(runtime);
  const other = await signUp(runtime);
  const created = await (await uploadFit(runtime, owner, ride())).json();
  for (const init of [{}, { method: "PUT", json: { fields: { name: "x" } } }, { method: "DELETE" }]) {
    const response = await v1(runtime, other, `/activities/${created.id}`, init);
    assert.equal(response.status, 404, JSON.stringify(init));
  }
});

test("stats count rides by the rider's local year and the last four weeks", async () => {
  const token = await signUp(runtime);
  const year = new Date().getUTCFullYear();
  // 03:00 UTC on New Year's Day is still the old year in Los Angeles.
  const newYear = new Date(`${year}-01-01T03:00:00Z`);
  await uploadFit(runtime, token, ride({ start: newYear }), { timezone: "Europe/Budapest" });
  await uploadFit(runtime, token, ride({ start: new Date(newYear.getTime() + 60_000) }), {
    timezone: "America/Los_Angeles",
  });
  await uploadFit(runtime, token, ride({ start: new Date(Date.now() - 2 * 86_400_000) }));
  const hidden = await (await uploadFit(runtime, token, ride({ start: new Date(Date.now() - 86_400_000) }))).json();
  await v1(runtime, token, `/activities/${hidden.id}`, { method: "PUT", json: { fields: { hidden: true } } });

  const stats = await (await v1(runtime, token, "/athlete/stats?timezone=Europe/Budapest")).json();
  assert.equal(stats.allRideTotals.count, 3, "hidden rides are not counted");
  assert.equal(stats.ytdRideTotals.count, 2, "the Los Angeles ride was last year there");
  assert.equal(stats.recentRideTotals.count, 1);
  assert.equal(stats.recentRideTotals.movingTime, 120);
  assert.equal(stats.recentRideTotals.kilojoules, 24);
});

test("the athlete is the signed-in rider", async () => {
  const token = await signUp(runtime);
  const athlete = await (await v1(runtime, token, "/athlete")).json();
  assert.match(athlete.name, /^Athlete /);
  assert.equal((await v1(runtime, null, "/athlete")).status, 401);
});
```

Run: `node --test tests/activities.test.mjs`
Expected: new tests FAIL.

- [ ] **Step 2: Implement the queries**

Append to `hosted/apps/api/src/activities/store.ts`:

```ts
import type { SummaryActivity } from "@trainstack/contract";
import { desc, gte, inArray, isNull, or, sql } from "drizzle-orm";

export const findLiveActivity = (db: Database, userId: string, id: string) =>
  db
    .select()
    .from(activity)
    .where(and(eq(activity.id, id), eq(activity.userId, userId), isNull(activity.deletedAt)))
    .get();

/** `<startDate>_<id>`, the last row of a page. */
const cursorOf = (row: ActivityRow) => `${row.startDate}_${row.id}`;

/** A cursor this API made, or nothing for anything else, which then starts from the newest. */
function parseCursor(cursor?: string) {
  const match = cursor ? /^(\d+)_(act_[0-9A-Z]{26})$/.exec(cursor) : null;
  return match ? { startDate: Number(match[1]), id: match[2] } : undefined;
}

export async function listActivities(
  db: Database,
  userId: string,
  query: { before?: number; after?: number; cursor?: string; limit: number },
) {
  const cursor = parseCursor(query.cursor);
  const rows = await db
    .select()
    .from(activity)
    .where(
      and(
        eq(activity.userId, userId),
        isNull(activity.deletedAt),
        query.before === undefined ? undefined : lt(activity.startDate, query.before),
        query.after === undefined ? undefined : gt(activity.startDate, query.after),
        cursor === undefined
          ? undefined
          : or(
              lt(activity.startDate, cursor.startDate),
              and(eq(activity.startDate, cursor.startDate), lt(activity.id, cursor.id)),
            ),
      ),
    )
    .orderBy(desc(activity.startDate), desc(activity.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  return {
    activities: page.map(toSummary) as SummaryActivity[],
    next: rows.length > query.limit ? cursorOf(page.at(-1)!) : null,
  };
}

const RIDES = ["Ride", "VirtualRide"];
const RECENT_MS = 28 * 24 * 60 * 60 * 1000;

/** Strava's ride totals: the last four weeks, this year in the rider's timezone, and ever. */
export async function athleteStats(
  db: Database,
  userId: string,
  timezone: string | null,
  now: number,
) {
  const totals = (extra?: SQL) =>
    db
      .select({
        count: sql<number>`count(*)`,
        distance: sql<number>`coalesce(sum(${activity.distance}), 0)`,
        movingTime: sql<number>`coalesce(sum(${activity.movingTime}), 0)`,
        elapsedTime: sql<number>`coalesce(sum(${activity.elapsedTime}), 0)`,
        kilojoules: sql<number>`coalesce(sum(${activity.kilojoules}), 0)`,
        trainingStress: sql<number>`coalesce(sum(${activity.trainingStress}), 0)`,
      })
      .from(activity)
      .where(
        and(
          eq(activity.userId, userId),
          isNull(activity.deletedAt),
          eq(activity.hidden, false),
          inArray(activity.sportType, RIDES),
          extra,
        ),
      )
      .get();
  const year = localTimestamp(now, timezone).slice(0, 4);
  const [recentRideTotals, ytdRideTotals, allRideTotals] = await Promise.all([
    totals(gte(activity.startDate, now - RECENT_MS)),
    totals(sql`substr(${activity.startDateLocal}, 1, 4) = ${year}`),
    totals(),
  ]);
  return { recentRideTotals: recentRideTotals!, ytdRideTotals: ytdRideTotals!, allRideTotals: allRideTotals! };
}
```

Merge the imports (`gt`, `type SQL` from `drizzle-orm`, `localTimestamp` is already imported)
into the file's existing import lines.

- [ ] **Step 3: Wire the handlers**

In `router.ts`, replace the `activities` and `athlete` stubs:

```ts
  activities: {
    list: api.activities.list
      .use(requireAuth)
      .use(withinBudget)
      .handler(({ context, input }) => listActivities(getDb(), context.session.user.id, input)),
    get: api.activities.get
      .use(requireAuth)
      .use(withinBudget)
      .handler(async ({ context, input, errors }) => detail(context.session.user.id, input.id, errors)),
    update: api.activities.update
      .use(requireAuth)
      .use(withinBudget)
      .handler(async ({ context, input, errors }) => {
        const userId = context.session.user.id;
        if (!(await findLiveActivity(getDb(), userId, input.id))) throw errors.NOT_FOUND();
        await applyChanges(getDb(), getBlobs(), userId, "server", [
          { changeId: "api", objectType: "activity", objectId: input.id, op: "update", fields: input.fields, clock: serverClock(Date.now()) },
        ], Date.now());
        return detail(userId, input.id, errors);
      }),
    delete: api.activities.delete
      .use(requireAuth)
      .use(withinBudget)
      .handler(async ({ context, input, errors }) => {
        const userId = context.session.user.id;
        if (!(await findLiveActivity(getDb(), userId, input.id))) throw errors.NOT_FOUND();
        await applyChanges(getDb(), getBlobs(), userId, "server", [
          { changeId: "api", objectType: "activity", objectId: input.id, op: "delete", clock: serverClock(Date.now()) },
        ], Date.now());
      }),
  },
  athlete: {
    get: api.athlete.get.use(requireAuth).use(withinBudget).handler(({ context }) => ({
      id: context.session.user.id,
      name: context.session.user.name,
      image: context.session.user.image ?? null,
      createdAt: new Date(context.session.user.createdAt).toISOString(),
    })),
    stats: api.athlete.stats
      .use(requireAuth)
      .use(withinBudget)
      .handler(({ context, input }) =>
        athleteStats(
          getDb(),
          context.session.user.id,
          input.timezone && isTimeZone(input.timezone) ? input.timezone : null,
          Date.now(),
        ),
      ),
  },
```

with, above the router:

```ts
/** An activity with what only the FIT file holds, its laps. */
async function detail(userId: string, id: string, errors: { NOT_FOUND: () => Error }) {
  const row = await findLiveActivity(getDb(), userId, id);
  if (!row) throw errors.NOT_FOUND();
  const bytes = await getBlobs().get(fitKey(userId, row.fitSha256));
  return { ...toSummary(row), description: row.description, laps: bytes ? parseLaps(bytes) : [] };
}
```

Delete `notYet` from `router.ts`; nothing uses it now.

- [ ] **Step 4: Run all tests**

Run: `bun run test && bun run check-types && bun run check`
Expected: all PASS, lint and format clean. `tests/worker.test.mjs` "OpenAPI reference describes
contract outputs" may need its expectations extended for the new paths; update the expectation,
not the contract.

- [ ] **Step 5: Commit**

```bash
git add hosted/apps/api/src/activities/store.ts hosted/apps/api/src/router.ts tests/activities.test.mjs
git commit -m "api: list, show, edit and delete activities and total a rider's rides"
```

---

### Task 10: Deleting an account removes its files

**Files:**
- Modify: `hosted/apps/api/src/auth/index.ts`
- Modify: `hosted/apps/api/src/services.ts`
- Test: `tests/activities.test.mjs` (append)

**Interfaces:**
- Consumes: `athletePrefix`, `getBlobs`.
- Produces: `createAuth(env, database, desktopOrigins?, hooks?: { beforeDeleteUser?: (userId: string) => Promise<void> })`.

- [ ] **Step 1: Write the failing test**

Append to `tests/activities.test.mjs`:

```js
test("deleting an account deletes its rides and their files", async () => {
  const email = `leaving-${Date.now()}@example.com`;
  const signup = await runtime.dispatchFetch("https://api.trainstackhq.com/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://trainstackhq.com" },
    body: JSON.stringify({ name: "Leaving", email, password: "leaving-password-123" }),
  });
  const token = signup.headers.get("set-auth-token");
  const created = await (await uploadFit(runtime, token, ride())).json();
  const userId = (await db.prepare("SELECT user_id FROM activity WHERE id = ?").bind(created.id).first()).user_id;

  const deleted = await runtime.dispatchFetch("https://api.trainstackhq.com/api/auth/delete-user", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password: "leaving-password-123" }),
  });
  assert.equal(deleted.status, 200, await deleted.clone().text());
  assert.equal((await bucket.list({ prefix: `athletes/${userId}/` })).objects.length, 0);
  assert.equal(await db.prepare("SELECT id FROM activity WHERE id = ?").bind(created.id).first(), null);
  assert.equal(await db.prepare("SELECT seq FROM sync_event WHERE user_id = ?").bind(userId).first(), null);
});
```

Run: `node --test tests/activities.test.mjs`
Expected: FAIL on the R2 listing.

- [ ] **Step 2: Implement**

In `auth/index.ts`, add a fourth parameter and use it:

```ts
export type AuthHooks = {
  /** Runs before the account's rows go, so a failure leaves the account to try again. */
  beforeDeleteUser?: (userId: string) => Promise<void>;
};
```

```ts
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          await hooks.beforeDeleteUser?.(user.id);
        },
      },
    },
```

Keep the existing comment above `user:` and extend it: "Files kept outside the database go first."

In `services.ts`:

```ts
export async function createAuth(database?: Database) {
  return createConfiguredAuth(ENV, database ?? (await getDb()), [], {
    beforeDeleteUser: (userId) => getBlobs().deletePrefix(athletePrefix(userId)),
  });
}
```

- [ ] **Step 3: Run all tests**

Run: `bun run test && bun run check-types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add hosted/apps/api/src/auth/index.ts hosted/apps/api/src/services.ts tests/activities.test.mjs
git commit -m "api: delete a rider's files with their account"
```

---

### Task 11: Document the API and protocol

**Files:**
- Create: `docs/sync.md`
- Modify: `docs/THESIS.md` or `docs/ride-alpha.md` only where they say rides never leave the
  device (search: `grep -n "device" docs/THESIS.md docs/ride-alpha.md`)

- [ ] **Step 1: Write `docs/sync.md`**

A page for whoever builds sub-project 3 (Ride's side). Cover, with one short example request
and response each: uploading (`PUT /v1/activities/fit/{sha256}` and its status codes), pushing
changes (the four change shapes and the three results), pulling events (cursor, `hasMore`, 410),
the manifest, the clock format and the 10-minute rule, and what a device must keep (outbox,
cursor, HLC, per-ride metadata sidecar with field clocks). Link the spec. Plain sentences, no em
dashes.

- [ ] **Step 2: Correct statements that are no longer true**

Wherever the docs say rides stay only on the device, say instead that a signed-in rider's rides
are kept on the server and synced, and that signed-out use keeps them on the device. Ride does
not upload anything until sub-project 3, so say "the server can keep" rather than "Ride keeps".

- [ ] **Step 3: Commit**

```bash
git add docs/sync.md docs/THESIS.md docs/ride-alpha.md
git commit -m "docs: describe the activity sync API for apps"
```

(Stage only the docs files you changed.)
