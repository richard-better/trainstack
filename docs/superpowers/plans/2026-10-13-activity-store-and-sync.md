# Activity Store and Two-Way Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every ride on the server (original FIT in R2, parsed summary in D1), sync rides and
rider settings both ways between devices, and serve a Strava-shaped TrainStack API at `/v1`.

**Architecture:** New modules in `hosted/apps/api/src/` (`budget/`, `storage/`, `activities/`,
`sync/`, `athletes/`) follow the `strava/` pattern: plain functions over the Drizzle database
plus a Hono route factory for the binary FIT routes. JSON endpoints are contract-first oRPC
procedures in `packages/contract`, served by a second `OpenAPIHandler` mounted at `/v1`. Every
write to a rider's data runs inside `AthleteWriter`, one Durable Object per rider, one operation
at a time; D1 stays the store of record and reads go straight to it. Sync is a server change log
with per-field last-write-wins on hybrid logical clocks. FIT files are read by our own decoder, a
port of Ride's `FITDecoder.swift`.

**Tech Stack:** Cloudflare Workers, Durable Objects, Hono, oRPC 1.15, zod 4, Drizzle 1.0 rc on D1,
R2, Better Auth 1.7.7, Alchemy 2 beta, Miniflare and `node --test` for tests, rolldown for
bundling.

**Spec:** `docs/superpowers/specs/2026-10-13-activity-store-and-sync-design.md`

## Global Constraints

- Never use the em dash character in code, comments, docs or commit messages. Use "-" or rephrase.
- Commits use Scoped Commits: `<scope>: <short description>` (scopes here: `api`, `contract`, `db`,
  `infra`, `tests`, `docs`, or a comma-separated list). No co-author lines.
- Stage only the files the task changed. Never `git add -A`. Never commit `bun.lock` changes: this
  plan adds no dependencies.
- Do not add `@garmin/fitsdk` or any other FIT library. Garmin's FIT SDK license allows internal
  business use only and forbids combining it with code under our licenses, and
  `tests/licenses.test.mjs` refuses it.
- Every write to a rider's `activity`, `settings_entry`, `sync_event`, `sync_state` and
  `pending_blob` rows, and to their files in R2, happens inside their `AthleteWriter`
  (`athletes/writer.ts`), through a `Writer`. Reads may go to D1 directly.
- Bodies: FIT uploads at most 10 MB (`MAX_FIT_BYTES`), JSON at most 1 MB (`MAX_JSON_BYTES`), both
  read as streams with `readBody`. Settings values at most 16 KB of JSON. Event and manifest pages
  at most 500 items and about 1 MB.
- Clock format: `<ms:15 digits>.<counter:6 digits>.<deviceId>`, device ID `[A-Za-z0-9-]{1,64}`,
  `server` reserved for the server. Clocks more than 10 minutes ahead are refused.
- Events are kept 180 days. Tombstones are kept forever.
- Budgets per rider per 15 minutes: 60 uploads (`upload:<userId>`), 300 other calls
  (`api:<userId>`).
- Blob keys: `athletes/<userId>/activities/<sha256>.fit`, sha256 is 64 lowercase hex characters.
- Every query filters by the session's user ID. Another rider's activity is `404`.
- Comments explain why, in the plain style of `strava/index.ts`. Match its density.
- Tests: `bun run test` (that is `node --test tests/*.test.mjs`). Types: `bun run check-types`
  (checks every workspace, including `hosted/infra`). Lint and format: `bun run check`; format
  with `bun run format` before committing.
- Migrations: `BETTER_AUTH_SECRET=generate-only-secret-with-32-characters bun run db:generate`.
  drizzle-kit loads the env schema, which requires a secret, though generating never uses it.
- Code in this plan is formatted as `bun run format` leaves it. Copy it exactly.

## Review Focus

1. Every mutation of a rider's data goes through `AthleteWriter`. Search for `.insert(`,
   `.update(`, `.delete(`, `INSERT`, `UPDATE`, `DELETE` and `blobs.put`/`blobs.delete` outside
   `athletes/`, `activities/store.ts`, `sync/apply.ts`, `sync/writer.ts` and `sync/events.ts`
   (`prune`): there must be none on those tables or that bucket prefix. (Tasks 6 to 10.)
2. A restored ride's `create` event carries each field's own clock, not the upload's clock, so a
   device that replays it cannot overwrite a newer edit. (Task 6, tested in Tasks 7 and 8.)
3. Whether a ride exists does not depend on the order uploads and deletes arrive in, and a live
   ride always has its file. (Tasks 6 and 7.)
4. After a zone change, every ride whose IF or TSS moved has an `update` event with its derived
   values; replaying events gives exactly the manifest. (Tasks 7 and 8.)
5. API edits use a clock past every clock the rider's data has seen, and the API reports failure
   if one did not win. (Tasks 2 and 9.)
6. A Garmin file recorded with Smart Recording or auto-pause gets the same NP and kJ as the same
   ride recorded every second without pauses; malformed files are always `422`, never `500`.
   (Task 3.)
7. A device pushes a change for a ride whose upload has not finished: the change comes back
   `unknown_object`, not an error. (Task 7.)

---

### Task 1: Shared rate budget and body reader

Preparatory refactor. Moves `spend`/`isSpent` and `readBody` out of `strava/` so the new modules
can use them, and renames the table to `rate_budget`.

**Files:**

- Create: `hosted/apps/api/src/budget/index.ts`
- Create: `hosted/apps/api/src/http.ts`
- Create: `hosted/apps/api/src/db/schema/budget.ts`
- Modify: `hosted/apps/api/src/db/schema/index.ts`
- Modify: `hosted/apps/api/src/db/schema/strava.ts` (remove `stravaBudget`)
- Modify: `hosted/apps/api/src/strava/index.ts`
- Modify: `tests/strava.test.mjs` (table name)
- Create: two generated migrations under `hosted/apps/api/src/db/migrations/`

**Interfaces:**

- Produces: `createBudget(database: () => Database): { spend(key: string, limit: number): Promise<boolean>; isSpent(key: string, limit: number): Promise<boolean> }`,
  `BUDGET_WINDOW_SECONDS = 900`, `MAX_FIT_BYTES`,
  `readBody(request: Request, limit: number): Promise<Uint8Array | undefined>`, table export
  `rateBudget`.

- [ ] **Step 1: Install dependencies**

Run: `bun install`
Expected: completes; `node_modules/` exists; `git status` shows no change to `bun.lock`.

- [ ] **Step 2: Run the existing tests as a baseline**

Run: `bun run test`
Expected: all pass. If a test fails before you change any code, write down which ones; they must
fail the same way, and no others, after every task. Do not fix them in this branch.

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

Add `export * from "./budget";` as the last line of `hosted/apps/api/src/db/schema/index.ts`.
Leave `stravaBudget` in place for now: drizzle-kit asks interactively whether a table was renamed
when one disappears and another appears in the same generate, and prompts cannot be answered
here.

Run: `BETTER_AUTH_SECRET=generate-only-secret-with-32-characters bun run db:generate`
Expected: a new migration folder whose `migration.sql` only creates `rate_budget`.

- [ ] **Step 4: Move the budget logic and the body reader**

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

Create `hosted/apps/api/src/http.ts`:

```ts
export const MAX_FIT_BYTES = 10 * 1024 * 1024;

/** The request's body, or nothing if it is longer than `limit`, without reading past the limit. */
export async function readBody(request: Request, limit: number): Promise<Uint8Array | undefined> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
```

Change `hosted/apps/api/src/strava/index.ts` as this diff shows: the constants, `spend`,
`isSpent` and `readBody` go, and the module uses the shared ones.

```diff
--- a/hosted/apps/api/src/strava/index.ts
+++ b/hosted/apps/api/src/strava/index.ts
@@ -1,8 +1,10 @@
-import { and, eq, isNull, lt, ne, sql } from "drizzle-orm";
+import { and, eq, isNull, lt, ne } from "drizzle-orm";
 import { Hono } from "hono";

 import type { Database } from "../db";
-import { account, stravaBudget, stravaConnection, stravaLink } from "../db/schema";
+import { createBudget } from "../budget";
+import { account, stravaConnection, stravaLink } from "../db/schema";
+import { MAX_FIT_BYTES, readBody } from "../http";
 import * as strava from "./api";
 import { createVault, type Vault } from "./crypto";

@@ -22,7 +24,6 @@ export type StravaDeps = {
 const APP_REDIRECT = "trainstackride://strava";
 /** How long a rider has to finish signing in on Strava's page. */
 const STATE_LIFETIME_SECONDS = 600;
-const MAX_FIT_BYTES = 10 * 1024 * 1024;

 /** What the state Strava gives back says: which sign-in this is. */
 type State = { link: string; expires: number };
@@ -40,7 +41,6 @@ const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
 const ATHLETE_CALLS = 30;
 const USER_CONNECTS = 10;
 const APP_EXCHANGES = 60;
-const BUDGET_WINDOW_SECONDS = 15 * 60;

 /** Signalled when Strava no longer accepts the rider's sign-in. */
 class NotConnected extends Error {}
@@ -60,6 +60,7 @@ export function stravaRoutes(deps: StravaDeps) {
   const fetcher = deps.fetcher ?? fetch;
   let vault: Promise<Vault> | undefined;
   const getVault = () => (vault ??= createVault(deps.env.BETTER_AUTH_SECRET));
+  const { spend, isSpent } = createBudget(deps.database);

   const credentials = (): strava.StravaCredentials | undefined =>
     deps.env.STRAVA_CLIENT_ID && deps.env.STRAVA_CLIENT_SECRET
@@ -121,40 +122,6 @@ export function stravaRoutes(deps: StravaDeps) {
       );
   };

-  /**
-   * Takes one call from the budget `key` if there is any left, in a single statement so that
-   * requests arriving together cannot all see room that is only there for one.
-   */
-  const spend = async (key: string, limit: number) => {
-    const now = nowSeconds();
-    const stale = sql`${stravaBudget.windowStart} <= ${now - BUDGET_WINDOW_SECONDS}`;
-    const spent = await deps
-      .database()
-      .insert(stravaBudget)
-      .values({ key, windowStart: now, used: 1 })
-      .onConflictDoUpdate({
-        target: stravaBudget.key,
-        set: {
-          used: sql`CASE WHEN ${stale} THEN 1 ELSE ${stravaBudget.used} + 1 END`,
-          windowStart: sql`CASE WHEN ${stale} THEN ${now} ELSE ${stravaBudget.windowStart} END`,
-        },
-        setWhere: sql`${stale} OR ${stravaBudget.used} < ${limit}`,
-      })
-      .returning({ key: stravaBudget.key });
-    return spent.length > 0;
-  };
-
-  /** Whether `key` has nothing left, to turn a request away before doing work for it. */
-  const isSpent = async (key: string, limit: number) => {
-    const row = await deps
-      .database()
-      .select()
-      .from(stravaBudget)
-      .where(eq(stravaBudget.key, key))
-      .get();
-    return !!row && row.used >= limit && row.windowStart > nowSeconds() - BUDGET_WINDOW_SECONDS;
-  };
-
   /**
    * Whether the account that holds an athlete has lost Strava's trust, which only the rider can
    * make happen, by removing Ride in their Strava settings. A holder Strava still accepts is
@@ -517,31 +484,6 @@ function shape(upload: StravaUpload) {
   return { id, status: "processing" };
 }

-/** The request's body, or nothing if it is longer than `limit`, without reading past the limit. */
-async function readBody(request: Request, limit: number): Promise<Uint8Array | undefined> {
-  const reader = request.body?.getReader();
-  if (!reader) return new Uint8Array();
-  const chunks: Uint8Array[] = [];
-  let length = 0;
-  for (;;) {
-    const { done, value } = await reader.read();
-    if (done) break;
-    length += value.byteLength;
-    if (length > limit) {
-      await reader.cancel();
-      return undefined;
-    }
-    chunks.push(value);
-  }
-  const body = new Uint8Array(length);
-  let offset = 0;
-  for (const chunk of chunks) {
-    body.set(chunk, offset);
-    offset += chunk.byteLength;
-  }
-  return body;
-}
-
 const toBase64Url = (bytes: ArrayBuffer) =>
   btoa(String.fromCharCode(...new Uint8Array(bytes)))
     .replaceAll("+", "-")
```

- [ ] **Step 5: Drop the old table**

Delete the `stravaBudget` export and its doc comment from `db/schema/strava.ts`:

```diff
--- a/hosted/apps/api/src/db/schema/strava.ts
+++ b/hosted/apps/api/src/db/schema/strava.ts
@@ -32,19 +32,6 @@ export const stravaConnection = sqliteTable(
   (table) => [uniqueIndex("strava_connection_athlete_idx").on(table.athleteId)],
 );

-/**
- * How much of a Strava request limit has been used. Strava limits the app as a whole, and counts
- * by athlete, so the keys are `athlete:<id>` (not the account, which anyone can make more of),
- * `user:<id>` for starting to connect, and one for the whole app. They outlive the connections
- * they count, so disconnecting and connecting again does not start a fresh budget.
- */
-export const stravaBudget = sqliteTable("strava_budget", {
-  key: text("key").primaryKey(),
-  /** When the current window began, in seconds since the epoch. */
-  windowStart: integer("window_start").notNull(),
-  used: integer("used").notNull(),
-});
-
 /**
  * A rider connecting Strava, from the app asking for the Strava page until the app collects the
  * result. The app keeps the verifier behind `challenge` to itself, so a sign-in only ever
```

Run: `BETTER_AUTH_SECRET=generate-only-secret-with-32-characters bun run db:generate`
Expected: a second new migration containing only ``DROP TABLE `strava_budget`;``. Budgets are
15-minute windows, so losing the old rows is harmless.

Run: `sd 'strava_budget' 'rate_budget' tests/strava.test.mjs`
Expected: the test now names `rate_budget` everywhere.

- [ ] **Step 6: Verify**

Run: `bun run format && bun run check-types && node --test tests/strava.test.mjs tests/worker.test.mjs`
Expected: types clean; all tests pass, the same count as before.

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
  `ZERO_CLOCK`, `MAX_CLOCK_SKEW_MS`,
  `formatClock(ms: number, counter: number, deviceId: string): string`,
  `parseClock(clock: string): { ms: number; counter: number; deviceId: string } | undefined`,
  `clockProblem(clock: string, now: number): "invalid" | "ahead" | undefined`,
  `nextClock(last: string, now: number, deviceId: string): string` (api);
  `newId(prefix: string, now?: number): string` (api);
  `importModule(path: string): Promise<any>` (tests).

`nextClock` is the HLC rule for making a clock from the spec: later than everything seen, no
earlier than the wall clock, and a full counter moves on a millisecond. Receiving a clock is
taking the greater string, which Task 6 does in `see`.

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
  for (const bad of [
    "",
    "1700000000000.0.a",
    "001700000000000.000000.",
    "001700000000000.000000.a b",
  ]) {
    assert.equal(clock.parseClock(bad), undefined, bad);
  }
});

test("a clock more than ten minutes ahead of the server is refused", () => {
  const now = 1_700_000_000_000;
  assert.equal(clock.clockProblem(clock.formatClock(now + 9 * 60_000, 0, "d"), now), undefined);
  assert.equal(clock.clockProblem(clock.formatClock(now + 11 * 60_000, 0, "d"), now), "ahead");
  assert.equal(clock.clockProblem("nonsense", now), "invalid");
});

test("a new clock follows the wall clock when it is ahead of everything seen", () => {
  const seen = clock.formatClock(1_700_000_000_000, 7, "zzzz");
  assert.equal(clock.nextClock(seen, 1_700_000_000_500, "server"), "001700000000500.000000.server");
  assert.equal(clock.nextClock(clock.ZERO_CLOCK, 5, "server"), "000000000000005.000000.server");
});

test("a new clock is later than everything seen, even a clock from the future", () => {
  const ahead = clock.formatClock(1_700_000_300_000, 4, "zzzz");
  const next = clock.nextClock(ahead, 1_700_000_000_000, "server");
  assert.equal(next, "001700000300000.000005.server");
  assert.ok(next > ahead, "the counter decides before the device ID");
  assert.ok(clock.nextClock(next, 1_700_000_000_000, "server") > next);
});

test("a full counter moves on a millisecond", () => {
  const full = clock.formatClock(1_700_000_000_000, 999_999, "a");
  assert.equal(clock.nextClock(full, 1_700_000_000_000, "b"), "001700000000001.000000.b");
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

Re-export it from `packages/contract/src/index.ts`:

```diff
--- a/packages/contract/src/index.ts
+++ b/packages/contract/src/index.ts
@@ -1,6 +1,8 @@
 import { oc, type ContractRouterClient } from "@orpc/contract";
 import { z } from "zod";

+export * from "./sync";
+
 export const userSchema = z.object({
   id: z.string(),
   name: z.string(),
```

Create `hosted/apps/api/src/sync/clock.ts`:

```ts
import { CLOCK_PATTERN } from "@trainstack/contract";

/** Older than any clock a device can make, for fields nobody has edited. */
export const ZERO_CLOCK = "000000000000000.000000.0";
/** How far ahead of the server a device's clock may be before its changes are refused. */
export const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;
/** The largest counter the six digits hold. */
const MAX_COUNTER = 999_999;

export function formatClock(ms: number, counter: number, deviceId: string) {
  return `${String(ms).padStart(15, "0")}.${String(counter).padStart(6, "0")}.${deviceId}`;
}

export function parseClock(clock: string) {
  if (!CLOCK_PATTERN.test(clock)) return undefined;
  const [ms, counter, deviceId] = clock.split(".") as [string, string, string];
  return { ms: Number(ms), counter: Number(counter), deviceId };
}

export function clockProblem(clock: string, now: number): "invalid" | "ahead" | undefined {
  const parsed = parseClock(clock);
  if (!parsed) return "invalid";
  return parsed.ms > now + MAX_CLOCK_SKEW_MS ? "ahead" : undefined;
}

/**
 * The clock for a new change made on `deviceId`: later than `last`, the highest clock this node
 * has made or seen, and no earlier than `now`. The counter only matters while the wall clock is
 * behind what was seen; once full, it moves on a millisecond rather than overflow.
 */
export function nextClock(last: string, now: number, deviceId: string) {
  const seen = parseClock(last) ?? { ms: 0, counter: 0 };
  if (now > seen.ms) return formatClock(now, 0, deviceId);
  if (seen.counter < MAX_COUNTER) return formatClock(seen.ms, seen.counter + 1, deviceId);
  return formatClock(seen.ms + 1, 0, deviceId);
}
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

Run: `bun run format && node --test tests/clock.test.mjs tests/contract.test.mjs && bun run check-types`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contract/src/sync.ts packages/contract/src/index.ts \
  hosted/apps/api/src/sync/clock.ts hosted/apps/api/src/ids.ts \
  tests/helpers/module.mjs tests/clock.test.mjs
git commit -m "api: add hybrid logical clocks and prefixed IDs for sync"
```

---

### Task 3: Reading FIT files and ride metrics

The server reads FIT with its own decoder, a TypeScript port of Ride's `FITDecoder.swift` (see the
Global Constraints for why not Garmin's SDK). Tests build files with a port of Ride's
`FITWriter`: `makeRideFit` writes exactly what `FITEncoder.swift` writes, and `makeFit` writes
Garmin-style files with Smart Recording, pauses and broken messages on demand.
`apps/ride/RideKit/Sources/RideData/Resources/SampleRide.fit` is a real Garmin Edge 530 file
(manufacturer 1, cycling, generic sub-sport, one record a second), so it is the Garmin fixture.

**Files:**

- Create: `hosted/apps/api/src/activities/fit-reader.ts`
- Create: `hosted/apps/api/src/activities/metrics.ts`
- Create: `hosted/apps/api/src/activities/fit.ts`
- Create: `packages/contract/src/activity.ts` (only the sport types for now)
- Modify: `packages/contract/src/index.ts`
- Create: `tests/helpers/fit.mjs`
- Test: `tests/fit.test.mjs`

**Interfaces:**

- Produces:
  - `class FitFormatError extends Error`, `type FitMessage = { global: number; fields: Map<number, number | string> }`,
    `fitChecksum(bytes: Uint8Array, start?: number, end?: number): number`,
    `readFit(bytes: Uint8Array): FitMessage[]`
  - `type PowerRecord = { second: number; power: number | null }`,
    `type Interval = { start: number; end: number }`,
    `powerBySecond(records: PowerRecord[], running: Interval[]): number[][]`,
    `normalizedPower(stretches: number[][]): number | null` (unrounded),
    `kilojoules(stretches: number[][]): number | null`,
    `trainingLoad(np: number | null, ftp: number | null, movingTime: number): { intensityFactor: number; trainingStress: number } | null`
  - `class InvalidFit extends Error`, `type ParsedActivity`, `type ParsedLap` (fields below),
    `parseFit(bytes: Uint8Array): ParsedActivity`, `parseLaps(bytes: Uint8Array): ParsedLap[]`
  - `sportTypes`, `sportTypeSchema`, `type SportType` (contract)
  - tests: `repeat(value, seconds)`, `fitTime(date)`, `field.{enumeration,uint8,uint16,uint32,string,bytes}(number, value)`,
    `makeFit(options)`, `makeRideFit(options)`

- [ ] **Step 1: Write the FIT fixture helpers**

Create `tests/helpers/fit.mjs`:

```js
/** FIT timestamps count seconds from 1989-12-31 00:00:00 UTC. */
const FIT_EPOCH = 631_065_600;

export const repeat = (value, seconds) => Array.from({ length: seconds }, () => value);

/** A date as a FIT timestamp. */
export const fitTime = (date) => Math.round(date.getTime() / 1000) - FIT_EPOCH;

const u16 = (value) => [value & 0xff, (value >> 8) & 0xff];
const u32 = (value) => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
];

/** One field of a message, as Ride's `FITWriter.Field`: number, base type and bytes. */
export const field = {
  enumeration: (number, value) => ({ number, type: 0x00, bytes: [value] }),
  uint8: (number, value) => ({ number, type: 0x02, bytes: [value ?? 0xff] }),
  uint16: (number, value) => ({ number, type: 0x84, bytes: u16(value ?? 0xffff) }),
  uint32: (number, value) => ({ number, type: 0x86, bytes: u32(value ?? 0xffffffff) }),
  string: (number, value) => ({
    number,
    type: 0x07,
    bytes: [...new TextEncoder().encode(value), 0],
  }),
  bytes: (number, value) => ({ number, type: 0x0d, bytes: value }),
};

function checksum(bytes) {
  const table = [
    0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401,
    0x5000, 0x9c01, 0x8801, 0x4400,
  ];
  let crc = 0;
  for (const byte of bytes) {
    let tmp = table[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ table[byte & 0xf];
    tmp = table[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ table[(byte >> 4) & 0xf];
  }
  return crc;
}

/** Writes FIT files the way Ride's `FITWriter` in `FITEncoder.swift` does, byte for byte. */
class FitWriter {
  body = [];

  /** A definition followed by its one data message. */
  message(local, global, fields) {
    this.definition(local, global, fields);
    this.data(local, fields);
  }

  definition(local, global, fields, developer = []) {
    this.body.push(
      0x40 | (developer.length > 0 ? 0x20 : 0) | local,
      0,
      0,
      ...u16(global),
      fields.length,
    );
    for (const f of fields) this.body.push(f.number, f.bytes.length, f.type);
    if (developer.length > 0) {
      this.body.push(developer.length);
      for (const d of developer) this.body.push(d.number, d.size, d.index);
    }
  }

  data(local, fields, developer) {
    this.body.push(local);
    for (const f of fields) this.body.push(...f.bytes);
    if (developer !== undefined) this.body.push(...u16(developer));
  }

  file() {
    const header = [
      14,
      0x20,
      ...u16(2140),
      ...u32(this.body.length),
      ...new TextEncoder().encode(".FIT"),
    ];
    header.push(...u16(checksum(header)));
    const content = [...header, ...this.body];
    return new Uint8Array([...content, ...u16(checksum(content))]);
  }
}

const MANUFACTURERS = { garmin: 1, development: 255 };
const SPORTS = { running: 1, cycling: 2, training: 10, rowing: 15 };
const SUB_SPORTS = { generic: 0, treadmill: 1, indoorCycling: 6, road: 7, indoorRowing: 14 };
const TIMER = { start: 0, stop: 1, stopAll: 4 };

/**
 * Builds an activity FIT file the way a Garmin head unit would, so tests know exactly what the
 * server should compute from it. `powers` holds one reading for each second the timer ran (null
 * for none). `every` writes a record only every so many seconds, as Smart Recording does, and
 * `pauses` stops the timer for a while at a second of riding, as auto-pause does. `extra` adds
 * raw `{ global, fields }` messages after the records, to make files broken in a particular way.
 */
export function makeFit({
  manufacturer = "garmin",
  sport = "cycling",
  subSport = "indoorCycling",
  start = new Date("2026-03-01T07:00:00Z"),
  powers = [],
  every = 1,
  pauses = [],
  heartRate,
  ftp,
  workoutName,
  laps = 1,
  sessions = 1,
  extra = [],
} = {}) {
  const writer = new FitWriter();
  const first = fitTime(start);
  // Wall-clock time of a second of riding, after the pauses up to it.
  const at = (second) =>
    first +
    second +
    pauses.filter((pause) => pause.at <= second).reduce((sum, pause) => sum + pause.seconds, 0);
  const riding = powers.length;
  const end = at(riding);
  const timer = (timestamp, type) =>
    writer.message(1, 21, [
      field.uint32(253, timestamp),
      field.enumeration(0, 0),
      field.enumeration(1, TIMER[type]),
    ]);

  writer.message(0, 0, [
    field.enumeration(0, 4),
    field.uint16(1, MANUFACTURERS[manufacturer]),
    field.uint16(2, 1),
    field.uint32(3, 1234),
    field.uint32(4, first),
  ]);
  if (ftp) writer.message(2, 7, [field.uint16(3, ftp)]);
  if (workoutName)
    writer.message(3, 26, [field.enumeration(4, SPORTS[sport]), field.string(8, workoutName)]);
  timer(first, "start");
  const record = (second, power) => [
    field.uint32(253, at(second)),
    field.uint8(3, heartRate),
    field.uint16(7, power),
  ];
  powers.forEach((power, second) => {
    const pause = pauses.find((candidate) => candidate.at === second);
    if (pause) {
      timer(at(second) - pause.seconds, "stop");
      timer(at(second), "start");
    }
    if (second % every === 0) writer.message(4, 20, record(second, power));
  });
  timer(end, "stopAll");
  for (const message of extra) writer.message(5, message.global, message.fields);
  const lapLength = Math.ceil(riding / laps);
  for (let lap = 0; lap < laps; lap++) {
    const from = lap * lapLength;
    const to = Math.min(riding, from + lapLength);
    writer.message(6, 19, [
      field.uint16(254, lap),
      field.uint32(253, at(to)),
      field.uint32(2, at(from)),
      field.uint32(7, (at(to) - at(from)) * 1000),
      field.uint32(8, (to - from) * 1000),
      field.enumeration(0, 9),
      field.enumeration(1, 1),
    ]);
  }
  for (let index = 0; index < sessions; index++) {
    writer.message(7, 18, [
      field.uint16(254, index),
      field.uint32(253, end),
      field.uint32(2, first),
      field.enumeration(5, SPORTS[sport]),
      field.enumeration(6, SUB_SPORTS[subSport]),
      field.uint32(7, (end - first) * 1000),
      field.uint32(8, riding * 1000),
      field.enumeration(0, 8),
      field.enumeration(1, 1),
    ]);
  }
  writer.message(8, 34, [
    field.uint32(253, end),
    field.uint32(0, riding * 1000),
    field.uint16(1, sessions),
    field.enumeration(2, 0),
    field.enumeration(3, 26),
    field.enumeration(4, 1),
  ]);
  return writer.file();
}

/**
 * Builds a FIT file exactly as Ride's `FITEncoder.swift` writes one: the same messages, local
 * numbers, field order and base types, manufacturer 255 (development), and the `target_power`
 * developer field on every record. Keep the two in step.
 */
export function makeRideFit({
  start = new Date("2026-03-01T07:00:00Z"),
  powers = [],
  targetPower = 200,
  heartRate,
  fitSport = [2, 6],
  workoutName,
} = {}) {
  const writer = new FitWriter();
  const first = fitTime(start);
  const end = first + powers.length;
  const duration = powers.length * 1000;
  const applicationId = [...new TextEncoder().encode("trainstack-ride!")];
  const readings = powers.filter((power) => power !== null);
  const averagePower =
    readings.length > 0
      ? Math.round(readings.reduce((a, b) => a + b, 0) / readings.length)
      : undefined;

  writer.message(0, 0, [
    field.enumeration(0, 4),
    field.uint16(1, 255),
    field.uint16(2, 0),
    field.uint32(4, first),
  ]);
  writer.message(1, 207, [
    field.bytes(0, applicationId),
    field.bytes(1, applicationId),
    field.uint8(3, 0),
  ]);
  writer.message(2, 206, [
    field.uint8(0, 0),
    field.uint8(1, 0),
    field.uint8(2, 0x84),
    field.string(3, "target_power"),
    field.string(8, "watts"),
    field.uint16(15, 20),
  ]);
  writer.message(3, 21, [
    field.uint32(253, first),
    field.enumeration(0, 0),
    field.enumeration(1, 0),
  ]);
  if (workoutName)
    writer.message(4, 26, [field.enumeration(4, fitSport[0]), field.string(8, workoutName)]);
  const record = (timestamp, power) => [
    field.uint32(253, timestamp),
    field.uint8(3, heartRate),
    field.uint8(4, undefined),
    field.uint32(5, undefined),
    field.uint16(6, undefined),
    field.uint16(7, power ?? undefined),
  ];
  writer.definition(5, 20, record(0, 0), [{ number: 0, size: 2, index: 0 }]);
  powers.forEach((power, second) => writer.data(5, record(first + second, power), targetPower));
  writer.message(3, 21, [field.uint32(253, end), field.enumeration(0, 0), field.enumeration(1, 4)]);
  writer.message(6, 19, [
    field.uint32(253, end),
    field.uint32(2, first),
    field.enumeration(0, 9),
    field.enumeration(1, 1),
    field.uint32(7, duration),
    field.uint32(8, duration),
  ]);
  writer.message(7, 18, [
    field.uint16(254, 0),
    field.uint32(253, end),
    field.uint32(2, first),
    field.enumeration(0, 8),
    field.enumeration(1, 1),
    field.enumeration(5, fitSport[0]),
    field.enumeration(6, fitSport[1]),
    field.uint32(7, duration),
    field.uint32(8, duration),
    field.uint32(9, undefined),
    field.uint8(16, heartRate),
    field.uint8(17, heartRate),
    field.uint16(20, averagePower),
    field.uint16(21, readings.length > 0 ? Math.max(...readings) : undefined),
    field.uint16(25, 0),
    field.uint16(26, 1),
  ]);
  writer.message(8, 34, [
    field.uint32(253, end),
    field.uint32(0, duration),
    field.uint16(1, 1),
    field.enumeration(2, 0),
    field.enumeration(3, 26),
    field.enumeration(4, 1),
  ]);
  return writer.file();
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/fit.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, test } from "node:test";
import { field, fitTime, makeFit, makeRideFit, repeat } from "./helpers/fit.mjs";
import { importModule } from "./helpers/module.mjs";

let fit;
let metrics;
before(async () => {
  fit = await importModule("hosted/apps/api/src/activities/fit.ts");
  metrics = await importModule("hosted/apps/api/src/activities/metrics.ts");
});

const seconds = (powers, start = 0) => powers.map((power, i) => ({ second: start + i, power }));
const running = (length, start = 0) => [{ start, end: start + length }];
const START = Date.parse("2026-03-01T07:00:00Z");

test("normalized power of a steady effort is that power", () => {
  const stretches = metrics.powerBySecond(seconds(repeat(200, 60)), running(60));
  assert.equal(metrics.normalizedPower(stretches), 200);
  assert.equal(metrics.kilojoules(stretches), 12);
});

test("normalized power weighs hard surges above their average", () => {
  // Thirty seconds at 0 W then thirty at 400 W: the rolling averages climb 0, 13.3, ..., 400, so
  // NP is 400/30 * (sum of k^4 for k = 0..30 / 31)^(1/4).
  const powers = [...repeat(0, 30), ...repeat(400, 30)];
  const np = metrics.normalizedPower(metrics.powerBySecond(seconds(powers), running(60)));
  assert.ok(Math.abs(np - 270.79) < 0.05, `got ${np}`);
});

test("each reading holds until the next record, as Smart Recording writes them", () => {
  const records = [
    { second: 0, power: 100 },
    { second: 5, power: 300 },
    { second: 9, power: 200 },
  ];
  assert.deepEqual(metrics.powerBySecond(records, running(12)), [
    [100, 100, 100, 100, 100, 300, 300, 300, 300, 200, 200, 200],
  ]);
});

test("of two records in one second, the later one counts", () => {
  const records = [
    { second: 0, power: 100 },
    { second: 0, power: 150 },
    { second: 1, power: 200 },
  ];
  assert.deepEqual(metrics.powerBySecond(records, running(2)), [[150, 200]]);
});

test("a record without power and a pause in the timer each end a stretch", () => {
  const dropout = [
    ...seconds(repeat(100, 40)),
    { second: 40, power: null },
    ...seconds(repeat(100, 20), 45),
  ];
  assert.deepEqual(
    metrics.powerBySecond(dropout, running(65)).map((s) => s.length),
    [40, 20],
  );
  const paused = [
    { start: 0, end: 40 },
    { start: 60, end: 100 },
  ];
  assert.deepEqual(
    metrics.powerBySecond(seconds(repeat(100, 100)), paused).map((s) => s.length),
    [40, 40],
  );
  // A reading from before a pause does not carry into the riding after it.
  assert.deepEqual(
    metrics.powerBySecond(
      [{ second: 0, power: 100 }],
      [
        { start: 0, end: 10 },
        { start: 20, end: 30 },
      ],
    ),
    [repeat(100, 10)],
  );
});

test("under thirty seconds of power has no normalized power", () => {
  assert.equal(
    metrics.normalizedPower(metrics.powerBySecond(seconds(repeat(300, 29)), running(29))),
    null,
  );
});

test("training load follows the TSS formula, and zero power is zero load", () => {
  assert.deepEqual(metrics.trainingLoad(250, 250, 3600), {
    intensityFactor: 1,
    trainingStress: 100,
  });
  assert.deepEqual(metrics.trainingLoad(0, 250, 3600), { intensityFactor: 0, trainingStress: 0 });
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
  assert.equal(parsed.startDate, START);
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

test("Smart Recording, with a record every five seconds, gives the same power as every second", () => {
  const parsed = fit.parseFit(makeFit({ powers: repeat(200, 600), every: 5 }));
  assert.equal(parsed.weightedAverageWatts, 200);
  assert.equal(parsed.averageWatts, 200);
  assert.equal(parsed.kilojoules, 120);
});

test("time with the timer stopped is neither riding nor zero watts", () => {
  const parsed = fit.parseFit(
    makeFit({ powers: repeat(200, 120), pauses: [{ at: 60, seconds: 600 }] }),
  );
  assert.equal(parsed.elapsedTime, 720);
  assert.equal(parsed.movingTime, 120);
  assert.equal(parsed.weightedAverageWatts, 200);
  assert.equal(parsed.kilojoules, 24);
});

test("records written out of order count for their own second", () => {
  const at = fitTime(new Date(START + 10_000));
  const late = { global: 20, fields: [field.uint32(253, at), field.uint16(7, 400)] };
  const parsed = fit.parseFit(makeFit({ powers: repeat(100, 60), extra: [late] }));
  assert.equal(parsed.kilojoules, 6.3);
  assert.equal(parsed.maxWatts, 400);
  assert.equal(parsed.averageWatts, 105);
});

test("an outdoor ride without power has no power metrics", () => {
  const parsed = fit.parseFit(
    makeFit({ subSport: "road", powers: repeat(null, 60), heartRate: 120 }),
  );
  assert.equal(parsed.sportType, "Ride");
  assert.equal(parsed.trainer, false);
  assert.equal(parsed.deviceWatts, false);
  assert.equal(parsed.averageWatts, null);
  assert.equal(parsed.weightedAverageWatts, null);
  assert.equal(parsed.kilojoules, null);
  assert.equal(parsed.averageHeartrate, 120);
});

test("a ride recorded on a Garmin Edge parses as an import", async () => {
  const bytes = new Uint8Array(
    await readFile("apps/ride/RideKit/Sources/RideData/Resources/SampleRide.fit"),
  );
  const parsed = fit.parseFit(bytes);
  assert.equal(parsed.source, "import");
  assert.equal(parsed.sportType, "Ride");
  assert.equal(parsed.trainer, false);
  assert.equal(parsed.elapsedTime, 1800);
  assert.equal(parsed.movingTime, 1800);
  assert.equal(parsed.averageWatts, 137);
  assert.equal(parsed.maxWatts, 177);
  assert.equal(parsed.weightedAverageWatts, 139);
  assert.equal(parsed.kilojoules, 245.578);
  assert.equal(fit.parseLaps(bytes).length, 10);
});

test("a ride written by Ride's own encoder parses as Ride's", () => {
  const parsed = fit.parseFit(
    makeRideFit({
      powers: [...repeat(200, 60), null, ...repeat(200, 59)],
      heartRate: 130,
      workoutName: "Sweet spot",
    }),
  );
  assert.equal(parsed.source, "ride");
  assert.equal(parsed.trainer, true);
  assert.equal(parsed.sportType, "VirtualRide");
  assert.equal(parsed.elapsedTime, 120);
  assert.equal(parsed.workoutName, "Sweet spot");
  assert.equal(parsed.weightedAverageWatts, 200);
  assert.equal(parsed.kilojoules, 23.8, "the second without a reading is not counted");
  assert.equal(parsed.averageHeartrate, 130);
  assert.equal(parsed.fitFtp, null);
});

test("laps come from the FIT file", () => {
  const laps = fit.parseLaps(makeFit({ powers: repeat(200, 120), laps: 2 }));
  assert.equal(laps.length, 2);
  assert.equal(laps[0].elapsedTime, 60);
  assert.equal(laps[1].startDate, "2026-03-01T07:01:00.000Z");
});

test("files the server cannot read are refused with a reason, never an exception", async () => {
  const sample = new Uint8Array(
    await readFile("apps/ride/RideKit/Sources/RideData/Resources/SampleRide.fit"),
  );
  const untimed = { global: 20, fields: [field.uint16(7, 300)] };
  const lapWithoutStart = { global: 19, fields: [field.uint16(254, 5), field.uint32(7, 10_000)] };
  const cases = {
    "not a FIT file": new Uint8Array([1, 2, 3, 4]),
    damaged: sample.slice(0, 5000),
    "no records": makeFit({ powers: [] }),
    "two sessions": makeFit({ powers: repeat(200, 60), sessions: 2 }),
    "a record without a time": makeFit({ powers: repeat(200, 60), extra: [untimed] }),
    "a lap without a start": makeFit({ powers: repeat(200, 60), extra: [lapWithoutStart] }),
  };
  for (const [name, bytes] of Object.entries(cases)) {
    assert.throws(() => fit.parseFit(bytes), fit.InvalidFit, name);
  }
  assert.throws(() => fit.parseFit(cases["two sessions"]), /more than one session/);
});
```

The SampleRide numbers are what the file holds: its session's average and maximum power (137 W,
177 W), and NP and kJ worked out from its 1,800 one-second records while the timer ran.

- [ ] **Step 3: Run to see it fail**

Run: `node --test tests/fit.test.mjs`
Expected: FAIL, modules missing.

- [ ] **Step 4: Implement the FIT reader**

Create `hosted/apps/api/src/activities/fit-reader.ts`:

```ts
/** The file cannot be read as FIT. `parseFit` turns this into a message for the rider. */
export class FitFormatError extends Error {}

/** A decoded data message: its global message number and its plain integer and string fields. */
export type FitMessage = { global: number; fields: Map<number, number | string> };

type FieldDefinition = { number: number; size: number; baseType: number };
type Definition = {
  global: number;
  bigEndian: boolean;
  fields: FieldDefinition[];
  /** The sizes of the developer fields, which are skipped. */
  developerSize: number;
};

const TIMESTAMP = 253;

/** FIT's CRC-16, over a header or a whole file. */
export function fitChecksum(bytes: Uint8Array, start = 0, end = bytes.length) {
  const table = [
    0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401,
    0x5000, 0x9c01, 0x8801, 0x4400,
  ];
  let crc = 0;
  for (let i = start; i < end; i++) {
    const byte = bytes[i]!;
    let tmp = table[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ table[byte & 0xf]!;
    tmp = table[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ table[(byte >> 4) & 0xf]!;
  }
  return crc;
}

function readInteger(bytes: Uint8Array, at: number, size: number, bigEndian: boolean) {
  let value = 0;
  for (let i = 0; i < size; i++) {
    value = value * 256 + bytes[bigEndian ? at + i : at + size - 1 - i]!;
  }
  return value;
}

/**
 * One integer or string field, or undefined for arrays, floats and the base type's "invalid"
 * marker, which readers skip. The same rules as Ride's `FITDecoder.swift`.
 */
function decodeValue(bytes: Uint8Array, at: number, field: FieldDefinition, bigEndian: boolean) {
  const integer = (width: number, signed: boolean, invalid?: number) => {
    if (field.size !== width) return undefined;
    const raw = readInteger(bytes, at, width, bigEndian);
    const bits = width * 8;
    if (raw === (invalid ?? (signed ? 2 ** (bits - 1) - 1 : 2 ** bits - 1))) return undefined;
    return signed && raw >= 2 ** (bits - 1) ? raw - 2 ** bits : raw;
  };
  switch (field.baseType) {
    case 7: {
      const end = bytes.subarray(at, at + field.size).indexOf(0);
      const raw = bytes.subarray(at, end === -1 ? at + field.size : at + end);
      return raw.length === 0 ? undefined : new TextDecoder().decode(raw);
    }
    case 0:
    case 2:
    case 13:
      return integer(1, false);
    case 1:
      return integer(1, true);
    case 3:
      return integer(2, true);
    case 4:
      return integer(2, false);
    case 5:
      return integer(4, true);
    case 6:
      return integer(4, false);
    case 10:
      return integer(1, false, 0);
    case 11:
      return integer(2, false, 0);
    case 12:
      return integer(4, false, 0);
    default:
      return undefined;
  }
}

/**
 * Every data message in a FIT file, after checking its header and checksum. A port of Ride's
 * `FITDecoder.swift`: definitions describe a layout and the data messages after them follow it.
 * Compressed timestamp headers are expanded into a `timestamp` field.
 */
export function readFit(bytes: Uint8Array): FitMessage[] {
  if (bytes.length < 14) throw new FitFormatError("This is not a FIT file.");
  const headerSize = bytes[0]!;
  const signature = new TextDecoder().decode(bytes.subarray(8, 12));
  if (headerSize < 12 || bytes.length < headerSize || signature !== ".FIT") {
    throw new FitFormatError("This is not a FIT file.");
  }
  const end = headerSize + readInteger(bytes, 4, 4, false);
  if (bytes.length < end + 2 || fitChecksum(bytes, 0, end) !== readInteger(bytes, end, 2, false)) {
    throw new FitFormatError("The FIT file is damaged.");
  }

  const definitions = new Map<number, Definition>();
  const messages: FitMessage[] = [];
  let position = headerSize;
  let lastTimestamp = 0;
  const take = (size: number) => {
    if (position + size > end) throw new FitFormatError("The FIT file is damaged.");
    const at = position;
    position += size;
    return at;
  };
  const byte = () => bytes[take(1)]!;
  const data = (definition: Definition) => {
    const fields = new Map<number, number | string>();
    for (const field of definition.fields) {
      const value = decodeValue(bytes, take(field.size), field, definition.bigEndian);
      if (value !== undefined) fields.set(field.number, value);
    }
    take(definition.developerSize);
    return { global: definition.global, fields };
  };

  while (position < end) {
    const header = byte();
    if (header & 0x80) {
      // A compressed timestamp header: a data message with a 5-bit time offset.
      const definition = definitions.get((header >> 5) & 0x03);
      if (!definition) throw new FitFormatError("The FIT file is damaged.");
      const message = data(definition);
      const offset = header & 0x1f;
      let timestamp = lastTimestamp - (lastTimestamp % 0x20) + offset;
      if (offset < lastTimestamp % 0x20) timestamp += 0x20;
      lastTimestamp = timestamp;
      message.fields.set(TIMESTAMP, timestamp);
      messages.push(message);
      continue;
    }
    const local = header & 0x0f;
    if (header & 0x40) {
      take(1); // reserved
      const bigEndian = byte() === 1;
      const global = readInteger(bytes, take(2), 2, bigEndian);
      const fields: FieldDefinition[] = [];
      for (let count = byte(), i = 0; i < count; i++) {
        fields.push({ number: byte(), size: byte(), baseType: byte() & 0x1f });
      }
      let developerSize = 0;
      if (header & 0x20) {
        for (let count = byte(), i = 0; i < count; i++) {
          byte(); // field number
          developerSize += byte();
          byte(); // developer data index
        }
      }
      definitions.set(local, { global, bigEndian, fields, developerSize });
      continue;
    }
    const definition = definitions.get(local);
    if (!definition) throw new FitFormatError("The FIT file is damaged.");
    const message = data(definition);
    const timestamp = message.fields.get(TIMESTAMP);
    if (typeof timestamp === "number") lastTimestamp = timestamp;
    messages.push(message);
  }
  return messages;
}
```

- [ ] **Step 5: Implement the metrics**

Create `hosted/apps/api/src/activities/metrics.ts`:

```ts
/** A second, as whole seconds since the epoch, and the power recorded for it if any. */
export type PowerRecord = { second: number; power: number | null };
/** Seconds the timer ran, `start` inclusive and `end` exclusive. */
export type Interval = { start: number; end: number };

const WINDOW_SECONDS = 30;

/**
 * Power for each second the timer ran, in stretches with a reading for every second. Head units
 * on Smart Recording write a record only when something changes, so each record's power holds
 * until the next record. A record without power, or a pause in the timer, ends a stretch.
 * `records` must be sorted by second; of two records in one second, the later one counts.
 */
export function powerBySecond(records: PowerRecord[], running: Interval[]): number[][] {
  const stretches: number[][] = [];
  let next = 0;
  for (const { start, end } of running) {
    let current: number[] = [];
    let held: number | null = null;
    while (next < records.length && records[next]!.second < start) next++;
    for (let second = start; second < end; second++) {
      while (next < records.length && records[next]!.second <= second) {
        held = records[next]!.power;
        next++;
      }
      if (held === null) {
        if (current.length > 0) stretches.push(current);
        current = [];
      } else {
        current.push(held);
      }
    }
    if (current.length > 0) stretches.push(current);
  }
  return stretches;
}

/** Coggan's normalized power: the fourth-power mean of 30-second rolling averages. */
export function normalizedPower(stretches: number[][]): number | null {
  let sum = 0;
  let count = 0;
  for (const stretch of stretches) {
    let window = 0;
    for (let i = 0; i < stretch.length; i++) {
      window += stretch[i]!;
      if (i >= WINDOW_SECONDS) window -= stretch[i - WINDOW_SECONDS]!;
      if (i >= WINDOW_SECONDS - 1) {
        sum += (window / WINDOW_SECONDS) ** 4;
        count++;
      }
    }
  }
  return count > 0 ? (sum / count) ** 0.25 : null;
}

/** Work in kJ over the seconds with a power reading; null without any. */
export function kilojoules(stretches: number[][]): number | null {
  if (stretches.length === 0) return null;
  let joules = 0;
  for (const stretch of stretches) for (const watts of stretch) joules += watts;
  return joules / 1000;
}

/**
 * IF and TSS from normalized power, FTP and moving time. Null without NP or FTP; a ride with NP
 * 0 has IF and TSS 0. This is the only place the formula lives.
 */
export function trainingLoad(np: number | null, ftp: number | null, movingTime: number) {
  if (np === null || ftp === null || ftp <= 0) return null;
  return {
    intensityFactor: np / ftp,
    trainingStress: (movingTime * np * np * 100) / (ftp * ftp * 3600),
  };
}
```

- [ ] **Step 6: Implement the parser**

`fit.ts` imports `SportType` from the contract. Create `packages/contract/src/activity.ts`:

```ts
import { z } from "zod";

/** Strava's sport types, as many as TrainStack can record or import. */
export const sportTypes = [
  "Ride",
  "VirtualRide",
  "Run",
  "VirtualRun",
  "Rowing",
  "Workout",
] as const;
export const sportTypeSchema = z.enum(sportTypes);
export type SportType = (typeof sportTypes)[number];
```

and re-export it from `packages/contract/src/index.ts`:

```diff
--- a/packages/contract/src/index.ts
+++ b/packages/contract/src/index.ts
@@ -1,6 +1,7 @@
 import { oc, type ContractRouterClient } from "@orpc/contract";
 import { z } from "zod";

+export * from "./activity";
 export * from "./sync";

 export const userSchema = z.object({
```

Create `hosted/apps/api/src/activities/fit.ts`:

```ts
import type { SportType } from "@trainstack/contract";

import { FitFormatError, type FitMessage, readFit } from "./fit-reader";
import { type Interval, kilojoules, normalizedPower, powerBySecond } from "./metrics";

/** The file is not a FIT activity the server can read. The message says why, for the rider. */
export class InvalidFit extends Error {}

export type ParsedActivity = {
  source: "ride" | "import";
  /** Milliseconds since the epoch. */
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

/** Global message numbers and field numbers from the FIT profile, for what the server reads. */
const FILE_ID = 0;
const ZONES_TARGET = 7;
const SESSION = 18;
const LAP = 19;
const RECORD = 20;
const EVENT = 21;
const WORKOUT = 26;
const TIMESTAMP = 253;
const START_TIME = 2;

/** FIT timestamps count seconds from 1989-12-31 00:00:00 UTC. */
const FIT_EPOCH_SECONDS = 631_065_600;
/** `file_id.manufacturer` for development, which Ride writes. */
const DEVELOPMENT = 255;
const ACTIVITY_FILE = 4;
const TIMER_EVENT = 0;
const TIMER_START = 0;
/** stop, stop_all, stop_disable and stop_disable_all. */
const TIMER_STOPS = new Set([1, 4, 8, 9]);
/** indoor_cycling, treadmill, indoor_rowing and virtual_activity. */
const INDOOR_SUB_SPORTS = new Set([6, 1, 14, 58]);
/** Longer than any ride; keeps the per-second arrays small whatever a file claims. */
const MAX_ELAPSED_SECONDS = 7 * 24 * 60 * 60;

const integer = (message: FitMessage | undefined, field: number) => {
  const value = message?.fields.get(field);
  return typeof value === "number" ? value : null;
};
const scaled = (message: FitMessage | undefined, field: number, scale: number) => {
  const value = integer(message, field);
  return value === null ? null : value / scale;
};
const text = (message: FitMessage | undefined, field: number) => {
  const value = message?.fields.get(field);
  return typeof value === "string" ? value : null;
};

const toMs = (fitSeconds: number) => (fitSeconds + FIT_EPOCH_SECONDS) * 1000;

/** The file's messages, checked to be one activity with one session the server can read. */
function readActivity(bytes: Uint8Array) {
  let messages: FitMessage[];
  try {
    messages = readFit(bytes);
  } catch (error) {
    if (error instanceof FitFormatError) throw new InvalidFit(error.message);
    throw new InvalidFit("The FIT file could not be read.");
  }
  const of = (global: number) => messages.filter((message) => message.global === global);
  if (integer(of(FILE_ID)[0], 0) !== ACTIVITY_FILE) {
    throw new InvalidFit("This FIT file is not an activity.");
  }
  const sessions = of(SESSION);
  if (sessions.length > 1) {
    throw new InvalidFit(
      "Activities with more than one session, such as multisport, are not supported.",
    );
  }
  const session = sessions[0];
  const start = integer(session, START_TIME);
  const elapsedTime = scaled(session, 7, 1000);
  const records = of(RECORD);
  if (start === null || elapsedTime === null || records.length === 0) {
    throw new InvalidFit("The FIT file has no recorded activity.");
  }
  if (elapsedTime > MAX_ELAPSED_SECONDS) {
    throw new InvalidFit("The activity is longer than a week.");
  }
  if (records.some((record) => integer(record, TIMESTAMP) === null)) {
    throw new InvalidFit("A record in the FIT file has no time.");
  }
  const laps = of(LAP).map((lap): ParsedLap => {
    const lapStart = integer(lap, START_TIME);
    const lapElapsed = scaled(lap, 7, 1000);
    if (lapStart === null || lapElapsed === null) {
      throw new InvalidFit("A lap in the FIT file has no time.");
    }
    return {
      startDate: new Date(toMs(lapStart)).toISOString(),
      elapsedTime: Math.round(lapElapsed),
      movingTime: Math.round(scaled(lap, 8, 1000) ?? lapElapsed),
      distance: scaled(lap, 9, 100),
      averageWatts: integer(lap, 19),
      maxWatts: integer(lap, 20),
      averageHeartrate: integer(lap, 15),
      averageCadence: integer(lap, 17),
    };
  });
  return { of, session: session!, start, elapsedTime, records, laps };
}

/**
 * When the timer ran, from its start and stop events, within the session. A file without timer
 * events ran for the whole session.
 */
function runningIntervals(events: FitMessage[], start: number, end: number): Interval[] {
  const timer = events
    .filter((event) => integer(event, 0) === TIMER_EVENT && integer(event, TIMESTAMP) !== null)
    .map((event) => ({ at: integer(event, TIMESTAMP)!, type: integer(event, 1) }))
    .sort((a, b) => a.at - b.at);
  if (timer.length === 0) return [{ start, end }];
  const intervals: Interval[] = [];
  let from: number | null = null;
  for (const event of timer) {
    if (event.type === TIMER_START && from === null) from = event.at;
    else if (event.type !== null && TIMER_STOPS.has(event.type) && from !== null) {
      intervals.push({ start: from, end: event.at });
      from = null;
    }
  }
  if (from !== null) intervals.push({ start: from, end });
  return intervals
    .map((interval) => ({
      start: Math.max(interval.start, start),
      end: Math.min(interval.end, end),
    }))
    .filter((interval) => interval.end > interval.start);
}

const mean = (values: number[]) =>
  values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
const highest = (values: number[]) => (values.length > 0 ? Math.max(...values) : null);

/** Strava's sport type for a FIT sport: cycling 2, running 1, rowing 15. */
function sportTypeOf(sport: number | null, trainer: boolean): SportType {
  switch (sport) {
    case 2:
      return trainer ? "VirtualRide" : "Ride";
    case 1:
      return trainer ? "VirtualRun" : "Run";
    case 15:
      return "Rowing";
    default:
      return "Workout";
  }
}

export function parseFit(bytes: Uint8Array): ParsedActivity {
  const { of, session, start, elapsedTime, records } = readActivity(bytes);
  const source = integer(of(FILE_ID)[0], 1) === DEVELOPMENT ? "ride" : "import";
  // Ride only records on a trainer, so its own files are trainer rides whatever the sub-sport.
  const trainer = source === "ride" || INDOOR_SUB_SPORTS.has(integer(session, 6) ?? -1);
  const running = runningIntervals(of(EVENT), start, start + Math.round(elapsedTime));
  // FIT times are whole seconds already; sorting keeps records written out of order in place,
  // and a stable sort keeps the later of two records in one second last.
  const timed = records.toSorted((a, b) => integer(a, TIMESTAMP)! - integer(b, TIMESTAMP)!);
  // Heart rate and cadence are held between records the same way as power.
  const bySecond = (field: number) =>
    powerBySecond(
      timed.map((record) => ({
        second: integer(record, TIMESTAMP)!,
        power: integer(record, field),
      })),
      running,
    );
  const power = bySecond(7);
  const watts = power.flat();
  const heartRates = bySecond(3).flat();
  const cadences = bySecond(4).flat();
  const np = normalizedPower(power);

  return {
    source,
    startDate: toMs(start),
    elapsedTime: Math.round(elapsedTime),
    movingTime: Math.round(scaled(session, 8, 1000) ?? elapsedTime),
    distance: scaled(session, 9, 100),
    averageWatts: integer(session, 20) ?? mean(watts),
    maxWatts: integer(session, 21) ?? highest(watts),
    weightedAverageWatts: np === null ? null : Math.round(np),
    kilojoules: kilojoules(power),
    deviceWatts: watts.length > 0,
    averageHeartrate: integer(session, 16) ?? mean(heartRates),
    maxHeartrate: integer(session, 17) ?? highest(heartRates),
    averageCadence: integer(session, 18) ?? mean(cadences),
    trainer,
    sportType: sportTypeOf(integer(session, 5), trainer),
    workoutName: text(of(WORKOUT)[0], 8),
    fitFtp: integer(of(ZONES_TARGET)[0], 3),
  };
}

export function parseLaps(bytes: Uint8Array): ParsedLap[] {
  return readActivity(bytes).laps;
}
```

- [ ] **Step 7: Run the tests**

Run: `bun run format && node --test tests/fit.test.mjs tests/licenses.test.mjs && bun run check-types`
Expected: PASS. If a SampleRide assertion fails, decode the file and look at its records before
changing the assertion: NP below average power, or kJ far from 137 W × 1800 s, means the
per-second reconstruction is wrong.

- [ ] **Step 8: Commit**

```bash
git add hosted/apps/api/src/activities/fit-reader.ts hosted/apps/api/src/activities/metrics.ts \
  hosted/apps/api/src/activities/fit.ts packages/contract/src/activity.ts \
  packages/contract/src/index.ts tests/helpers/fit.mjs tests/fit.test.mjs
git commit -m "api: read FIT activities and compute normalized power, kJ and TSS"
```

---

### Task 4: Contract for activities, athlete and sync

**Files:**

- Modify: `packages/contract/src/activity.ts`
- Modify: `packages/contract/src/sync.ts`
- Modify: `packages/contract/src/index.ts`
- Modify: `hosted/apps/api/src/router.ts`
- Test: `tests/contract.test.mjs`

**Interfaces:**

- Produces (all exported from `@trainstack/contract`):
  - `isTimeZone(name: string): boolean`, `timeZoneSchema`, `summaryActivitySchema`,
    `SummaryActivity`, `lapSchema`, `detailedActivitySchema`, `DetailedActivity`,
    `updatableActivitySchema`, `UpdatableActivity`, `athleteSchema`, `totalsSchema`,
    `athleteStatsSchema`, `AthleteStats`, `manifestActivitySchema`, `ManifestActivity`,
    `derivedSchema`, `Derived`;
  - `deviceIdSchema`, `settingsKinds`, `SettingsKind`, `MAX_SETTINGS_VALUE_BYTES`,
    `zoneChangeValueSchema`, `ftpTestValueSchema`, `preferenceValueSchema`, `syncChangeSchema`,
    `SyncChange`, `changeResultSchema`, `ChangeResult`, `changeProblemSchema`, `ChangeProblem`,
    `syncEventSchema`, `SyncEvent`, `settingsEntrySchema`, `SettingsEntry`, `manifestSchema`,
    `MAX_PAGE_ITEMS`;
  - `appContract.activities.{list,get,update,delete}`, `appContract.athlete.{get,stats}`,
    `appContract.sync.{push,events,manifest}` with the routes below.

- [ ] **Step 1: Write the failing test**

Append to `tests/contract.test.mjs`:

```js
test("the sync contract refuses changes the server must never apply", async () => {
  const { importModule } = await import("./helpers/module.mjs");
  const contract = await importModule("packages/contract/src/index.ts");
  const valid = (change) => contract.syncChangeSchema.safeParse(change).success;
  const clock = "001700000000000.000000.device-a";
  const edit = { changeId: "c1", objectType: "activity", objectId: "act_1", op: "update", clock };
  assert.ok(valid({ ...edit, fields: { name: "Hill repeats", timezone: "Europe/Budapest" } }));
  assert.ok(!valid({ ...edit, fields: {} }), "no fields");
  assert.ok(!valid({ ...edit, fields: { distance: 1 } }), "read-only field");
  assert.ok(!valid({ ...edit, fields: { timezone: "Mars/Olympus_Mons" } }), "unknown time zone");
  assert.ok(!valid({ ...edit, fields: { name: "x" }, clock: "1" }), "malformed clock");

  const zones = { changeId: "c2", objectType: "settings", kind: "zone_change", op: "put", clock };
  const ftp = { changes: [{ type: "threshold", threshold: "ftp", scope: "all", value: 250 }] };
  assert.ok(valid({ ...zones, entryId: "2026-03-01", value: ftp }));
  assert.ok(
    !valid({ ...zones, entryId: "8E2B6A9C-0000-4000-8000-000000000001", value: ftp }),
    "zone entries are days",
  );
  assert.ok(!valid({ ...zones, entryId: "2026-02-30", value: ftp }), "a day that does not exist");

  const preference = {
    changeId: "c3",
    objectType: "settings",
    kind: "preference",
    entryId: "units",
    op: "put",
    clock,
  };
  assert.ok(valid({ ...preference, value: "metric" }));
  assert.ok(
    !valid({ ...preference, value: "x".repeat(contract.MAX_SETTINGS_VALUE_BYTES) }),
    "too large",
  );

  assert.ok(!contract.deviceIdSchema.safeParse("server").success, "the server's own device ID");
  assert.ok(contract.deviceIdSchema.safeParse("8E2B6A9C-0000-4000-8000-000000000001").success);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/contract.test.mjs`
Expected: FAIL, `syncChangeSchema` undefined.

- [ ] **Step 3: Write the activity schemas**

Append to `packages/contract/src/activity.ts`:

```ts
/** Whether the runtime knows `name` as an IANA time zone. */
export function isTimeZone(name: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z.string().min(1).max(64).refine(isTimeZone, "Unknown time zone.");

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
  /** The FTP IF and TSS were worked out with: the file's own, or the rider's on that day. */
  ftp: z.number().int().nullable(),
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

/**
 * What a rider can change about an activity: Strava's UpdatableActivity, plus the time zone,
 * which a device may have got wrong or not known when it uploaded.
 */
export const updatableActivitySchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    description: z.string().max(10_000).nullable(),
    sportType: sportTypeSchema,
    hidden: z.boolean(),
    timezone: timeZoneSchema.nullable(),
  })
  .partial()
  .strict()
  .refine((fields) => Object.keys(fields).length > 0, "Change at least one field.");
export type UpdatableActivity = z.infer<typeof updatableActivitySchema>;

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
export type AthleteStats = z.infer<typeof athleteStatsSchema>;

/**
 * Everything a device must know about an activity, deleted or not: its fields with their clocks,
 * which it merges by last-write-wins, and what the server works out, which it takes as given.
 */
export const manifestActivitySchema = summaryActivitySchema.extend({
  description: z.string().nullable(),
  deleted: z.boolean(),
  clocks: z.object({
    name: z.string(),
    description: z.string(),
    sportType: z.string(),
    hidden: z.string(),
    timezone: z.string(),
    existence: z.string(),
  }),
});
export type ManifestActivity = z.infer<typeof manifestActivitySchema>;

/** What the server works out for an activity from its fields and the rider's zone history. */
export const derivedSchema = z.object({
  startDateLocal: z.string(),
  ftp: z.number().int().nullable(),
  intensityFactor: z.number().nullable(),
  trainingStress: z.number().nullable(),
});
export type Derived = z.infer<typeof derivedSchema>;
```

- [ ] **Step 4: Write the sync schemas**

Replace `packages/contract/src/sync.ts` with:

```ts
import { z } from "zod";

import { manifestActivitySchema, updatableActivitySchema } from "./activity";

/**
 * A hybrid logical clock: milliseconds, a counter for changes within one millisecond, and the
 * device that made it. Zero-padded so that comparing the strings compares the clocks.
 */
export const CLOCK_PATTERN = /^\d{15}\.\d{6}\.[A-Za-z0-9-]{1,64}$/;

export const clockSchema = z.string().regex(CLOCK_PATTERN);

/** A device's install ID. `server` is the server's own, for edits made through the API. */
export const deviceIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,64}$/)
  .refine((id) => id !== "server", "`server` is reserved for the server.");

export const settingsKinds = ["zone_change", "ftp_test", "preference"] as const;
export type SettingsKind = (typeof settingsKinds)[number];

/** The largest settings value, as JSON. D1 rows hold 2 MB; settings need a few hundred bytes. */
export const MAX_SETTINGS_VALUE_BYTES = 16 * 1024;

const fits = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_SETTINGS_VALUE_BYTES;
const tooLarge = `Settings values are limited to ${MAX_SETTINGS_VALUE_BYTES} bytes of JSON.`;

/**
 * The changes Ride's zone history made on one local day; the entry ID is the day. The server
 * reads the Default-scope FTP from it; other changes are kept as the app sent them.
 */
export const zoneChangeValueSchema = z
  .object({
    changes: z
      .array(
        z.union([
          z.object({
            type: z.literal("threshold"),
            threshold: z.string().min(1).max(64),
            scope: z.string().min(1).max(64),
            value: z.number().int().positive().nullable(),
          }),
          z.looseObject({ type: z.enum(["choice", "ownZones", "listed"]) }),
        ]),
      )
      .min(1)
      .max(64),
  })
  .refine(fits, tooLarge);

export const ftpTestValueSchema = z.object({
  date: z.iso.datetime(),
  kind: z.string().min(1).max(64),
  ftp: z.number().int().positive(),
  scope: z.string().min(1).max(64),
});

export const preferenceValueSchema = z.json().refine(fits, tooLarge);

const changeId = z.string().min(1).max(64);
/** Letters, digits and `.`, `_`, `:`, `-`: UUIDs, days and preference keys all fit. */
const entryId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const day = z.iso.date();

export const syncChangeSchema = z.union([
  z.strictObject({
    changeId,
    objectType: z.literal("activity"),
    objectId: z.string().min(1).max(64),
    op: z.literal("update"),
    fields: updatableActivitySchema,
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
    entryId: day,
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
    value: preferenceValueSchema,
    clock: clockSchema,
  }),
  z.strictObject({
    changeId,
    objectType: z.literal("settings"),
    kind: z.literal("zone_change"),
    entryId: day,
    op: z.literal("delete"),
    clock: clockSchema,
  }),
  z.strictObject({
    changeId,
    objectType: z.literal("settings"),
    kind: z.enum(["ftp_test", "preference"]),
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

/** Why a push was refused, one entry for each change at fault. */
export const changeProblemSchema = z.object({
  index: z.number().int(),
  reason: z.enum(["invalid_change", "clock_ahead"]),
  message: z.string(),
});
export type ChangeProblem = z.infer<typeof changeProblemSchema>;

/**
 * A change as Strava's webhook events describe one, with its clock. `updates` is, for an
 * activity, the whole `ManifestActivity` on `create`, `{ fields?, derived? }` on `update` and
 * null on `delete`; for a settings entry, `{ value }` on `create` and `update` and null on
 * `delete`.
 */
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
export type SettingsEntry = z.infer<typeof settingsEntrySchema>;

export const manifestSchema = z.object({
  /** Where to pull events from once every page is read. The same on every page. */
  cursor: z.number().int(),
  activities: z.array(manifestActivitySchema),
  settings: z.array(settingsEntrySchema),
  /** The next page, or null after the last. */
  next: z.string().nullable(),
  serverTime: z.number().int(),
});
```

Notes on choices the tests pin down:

- A zone change's entry ID is its local day (`z.iso.date()`), so two devices editing the same
  day write the same entry and settle by last-write-wins.
- `push` takes `changes` as `unknown[]` and the procedure checks each one against
  `syncChangeSchema` (Task 7), so every bad change is reported by index in `INVALID_CHANGES`
  rather than as oRPC's generic validation error.

- [ ] **Step 5: Add the procedures**

Replace `packages/contract/src/index.ts` with:

```ts
import { oc, type ContractRouterClient } from "@orpc/contract";
import { z } from "zod";

import {
  athleteSchema,
  athleteStatsSchema,
  detailedActivitySchema,
  summaryActivitySchema,
  timeZoneSchema,
  updatableActivitySchema,
} from "./activity";
import {
  changeProblemSchema,
  changeResultSchema,
  deviceIdSchema,
  manifestSchema,
  syncEventSchema,
} from "./sync";

export * from "./activity";
export * from "./sync";

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** At most this many events or manifest entries in one page. */
export const MAX_PAGE_ITEMS = 500;

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
    .output(z.object({ activities: z.array(summaryActivitySchema), next: z.string().nullable() })),
  get: owner
    .errors({ NOT_FOUND: {} })
    .route({ method: "GET", path: "/activities/{id}" })
    .input(z.object({ id: z.string() }))
    .output(detailedActivitySchema),
  update: owner
    .errors({ NOT_FOUND: {}, CONFLICT: {} })
    .route({ method: "PUT", path: "/activities/{id}" })
    .input(z.object({ id: z.string(), fields: updatableActivitySchema }))
    .output(detailedActivitySchema),
  delete: owner
    .errors({ NOT_FOUND: {}, CONFLICT: {} })
    .route({ method: "DELETE", path: "/activities/{id}", successStatus: 204 })
    .input(z.object({ id: z.string() }))
    .output(z.void()),
};

const athlete = {
  get: owner.route({ method: "GET", path: "/athlete" }).output(athleteSchema),
  stats: owner
    .route({ method: "GET", path: "/athlete/stats" })
    .input(
      z.object({
        /** The rider's time zone, which decides what "this year" and "the last 4 weeks" are. */
        timezone: timeZoneSchema.optional(),
        /** The moment to report for, in milliseconds since the epoch; now if left out. */
        at: z.coerce.number().int().min(0).optional(),
      }),
    )
    .output(athleteStatsSchema),
};

const sync = {
  push: owner
    .errors({
      INVALID_CHANGES: {
        status: 400,
        data: z.object({ problems: z.array(changeProblemSchema) }),
      },
    })
    .route({ method: "POST", path: "/sync/changes" })
    .input(
      z.object({
        deviceId: deviceIdSchema,
        /**
         * Each a `SyncChange`. Checked one by one by the procedure, so that every malformed
         * change is reported with its index in `INVALID_CHANGES`.
         */
        changes: z.array(z.unknown()).max(500),
      }),
    )
    .output(z.object({ results: z.array(changeResultSchema), serverTime: z.number().int() })),
  events: owner
    .errors({ CURSOR_EXPIRED: { status: 410 } })
    .route({ method: "GET", path: "/sync/events" })
    .input(
      z.object({
        after: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(MAX_PAGE_ITEMS).default(MAX_PAGE_ITEMS),
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
  manifest: owner
    .errors({ INVALID_PAGE: { status: 400 } })
    .route({ method: "GET", path: "/sync/manifest" })
    .input(
      z.object({
        page: z.string().max(256).optional(),
        limit: z.coerce.number().int().min(1).max(MAX_PAGE_ITEMS).default(MAX_PAGE_ITEMS),
      }),
    )
    .output(manifestSchema),
};

export const appContract = {
  healthCheck: oc.output(z.literal("OK")),
  privateData: oc.errors({ UNAUTHORIZED: {} }).output(
    z.object({
      message: z.literal("This is private"),
      user: userSchema,
    }),
  ),
  activities,
  athlete,
  sync,
};

export type AppContractClient = ContractRouterClient<typeof appContract>;
```

The update input nests the editable fields under `fields` so that the path parameter `id`
cannot collide with them. Over OpenAPI the body is `{ "fields": { ... } }`.

- [ ] **Step 6: Keep the API compiling**

`implement(appContract)` requires a handler for every procedure. Until Tasks 7 to 9 replace
them, the new procedures answer `NOT_IMPLEMENTED`. Replace `hosted/apps/api/src/router.ts` with:

```ts
import { implement, ORPCError } from "@orpc/server";
import { appContract } from "@trainstack/contract";

import type { Context } from "./context";

const api = implement(appContract).$context<Context>();

const requireAuth = api.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context: { session: context.session } });
});

/** Answers procedures this branch has not built yet; the last of them goes in Task 9. */
const notYet = () => {
  throw new ORPCError("NOT_IMPLEMENTED");
};

export const appRouter = api.router({
  healthCheck: api.healthCheck.handler(() => "OK"),
  privateData: api.privateData.use(requireAuth).handler(({ context }) => ({
    message: "This is private",
    user: context.session.user,
  })),
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
});
```

- [ ] **Step 7: Run the tests and types**

Run: `bun run format && node --test tests/contract.test.mjs tests/worker.test.mjs && bun run check-types`
Expected: PASS.

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
- Test: `tests/worker.test.mjs` (its migration test applies every committed migration)

**Interfaces:**

- Produces: tables `activity` (row type `ActivityRow`), `settingsEntry`, `syncEvent`,
  `syncState` (`userId`, `prunedThrough`, `clock`) and `pendingBlob` (`userId`, `fitSha256`,
  `createdAt`).

- [ ] **Step 1: Write the schema**

Create `hosted/apps/api/src/db/schema/activity.ts`:

```ts
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

/**
 * A ride, parsed from the FIT file kept in R2. The file's SHA-256 is what devices know it by;
 * `id` is what the API calls it. Each editable field has its own clock, so edits to different
 * fields on different devices all survive. A deleted ride keeps its row as a tombstone so that a
 * device that missed the delete cannot bring it back. Only the rider's `AthleteWriter` writes it.
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
    timezoneClock: text("timezone_clock").notNull(),
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
    /** The clock of the newest upload or delete, which decides whether the ride exists. */
    existenceClock: text("existence_clock").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
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
    /** The day for a zone change, the test's UUID for an FTP test, the key for a preference. */
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

/** Per rider: how far the event log has been pruned, and the server's clock for them. */
export const syncState = sqliteTable("sync_state", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** The newest event pruned. A device whose cursor is behind this must start over. */
  prunedThrough: integer("pruned_through").notNull(),
  /** The highest clock the server has made or seen for the rider. */
  clock: text("clock").notNull(),
});

/**
 * A FIT file whose existence in R2 may not match its activity row yet: written before its row,
 * or left behind by a delete. The sweep deletes it unless its ride is live, then the mark.
 */
export const pendingBlob = sqliteTable(
  "pending_blob",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fitSha256: text("fit_sha256").notNull(),
    /** Milliseconds since the epoch. */
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.fitSha256] })],
);
```

Append to `db/schema/index.ts`:

```ts
export * from "./activity";
export * from "./sync";
```

- [ ] **Step 2: Generate the migration**

Run: `BETTER_AUTH_SECRET=generate-only-secret-with-32-characters bun run db:generate && bun run format`
Expected: one new migration creating `activity`, `settings_entry`, `sync_event`, `sync_state`,
`pending_blob` and their indexes. Read the SQL: `seq` must be `integer PRIMARY KEY AUTOINCREMENT`,
and every `user_id` must reference `user(id)` with `ON DELETE CASCADE`.

- [ ] **Step 3: Verify**

Run: `bun run check-types && node --test tests/worker.test.mjs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add hosted/apps/api/src/db/schema hosted/apps/api/src/db/migrations
git commit -m "db: add activity, settings, sync event and pending file tables"
```

---

### Task 6: The rider's writer, blob storage and FIT uploads

This task brings in `AthleteWriter`, the Durable Object every later write goes through, and the
first operation it runs: storing an upload.

How an operation runs: the route validates the request, parses the FIT file in the Worker, and
calls `writerOf(userId).upload(userId, input)`. The writer queues the call behind any running
operation, sets its sweep alarm if none is set, opens a `Writer` (the database, the blobs, the
rider's ID, the time, and the rider's HLC from `sync_state`), runs the operation, and sweeps
pending files afterwards. `commit` writes a batch together with the advanced HLC.

**Files:**

- Create: `hosted/apps/api/src/storage/index.ts`
- Create: `hosted/apps/api/src/activities/local-time.ts`
- Create: `hosted/apps/api/src/activities/ftp.ts`
- Create: `hosted/apps/api/src/activities/training.ts`
- Create: `hosted/apps/api/src/activities/shape.ts`
- Create: `hosted/apps/api/src/sync/writer.ts`
- Create: `hosted/apps/api/src/activities/store.ts`
- Create: `hosted/apps/api/src/athletes/writer.ts`
- Create: `hosted/apps/api/src/activities/routes.ts`
- Modify: `hosted/apps/api/src/services.ts`, `hosted/apps/api/src/index.ts`
- Modify: `hosted/infra/alchemy.run.ts`
- Modify: `tests/helpers/worker.mjs`
- Create: `tests/helpers/riders.mjs`
- Test: `tests/ftp.test.mjs`, `tests/activities.test.mjs`

**Interfaces:**

- Consumes: `parseFit`, `InvalidFit`, `ParsedActivity`, `trainingLoad` (Task 3); `clockProblem`,
  `nextClock`, `ZERO_CLOCK` (Task 2); `createBudget`, `MAX_FIT_BYTES`, `readBody` (Task 1);
  `newId`; the tables (Task 5); `SummaryActivity`, `ManifestActivity`, `Derived`,
  `deviceIdSchema`, `isTimeZone`, `zoneChangeValueSchema` (Task 4).
- Produces:
  - `type Blobs = { put(key: string, bytes: Uint8Array): Promise<void>; get(key: string): Promise<Uint8Array<ArrayBuffer> | undefined>; delete(key: string): Promise<void>; deletePrefix(prefix: string): Promise<void> }`,
    `r2Blobs(bucket: R2Bucket): Blobs`, `athletePrefix(userId: string): string`,
    `fitKey(userId: string, sha256: string): string`
  - `localTimestamp(ms: number, timeZone: string | null): string`,
    `defaultName(sportType: SportType, startDateLocal: string): string`
  - `type FtpChange = { day: string; ftp: number | null }`,
    `type ZoneEntry = { day: string; value: unknown }`,
    `ftpChanges(entries: ZoneEntry[]): FtpChange[]`,
    `ftpOn(changes: FtpChange[], day: string): number | null`,
    `type DeriveInput = { startDate: number; timezone: string | null; fitFtp: number | null; weightedAverageWatts: number | null; movingTime: number }`,
    `derive(input: DeriveInput, changes: FtpChange[]): Derived`
  - `loadZoneEntries(writer: Writer): Promise<ZoneEntry[]>`
  - `toSummary(row: ActivityRow): SummaryActivity`, `toManifestActivity(row: ActivityRow): ManifestActivity`
  - `type Writer = { db: Database; blobs: Blobs; userId: string; now: number; clock: string }`,
    `type Statement = BatchItem<"sqlite">`,
    `type NewEvent = { objectType: "activity" | "settings"; objectId: string; aspectType: "create" | "update" | "delete"; updates: Record<string, unknown> | null; clock: string; deviceId: string }`,
    `SERVER = "server"`,
    `openWriter(db: Database, blobs: Blobs, userId: string, now: number): Promise<Writer>`,
    `see(writer: Writer, clock: string): void`, `serverClock(writer: Writer): string`,
    `commit(writer: Writer, statements: Statement[]): Promise<void>`,
    `jsonChunks(items: unknown[]): string[]`,
    `insertEvents(writer: Writer, events: NewEvent[]): Statement[]`,
    `markPending(writer: Writer, sha256s: string[]): Statement[]`,
    `clearPending(writer: Writer, sha256: string): Statement`, `sweep(writer: Writer): Promise<void>`
  - `type UploadInput = { sha256: string; fit: Uint8Array; parsed: ParsedActivity; clock: string; deviceId: string; timezone: string | null; externalId: string | null }`,
    `type UploadResult = { kind: "created" | "restored" | "existing" | "deleted"; activity: SummaryActivity }`,
    `storeUpload(writer: Writer, input: UploadInput): Promise<UploadResult>`
  - `class AthleteWriter extends DurableObject` with `upload(userId: string, input: UploadInput): Promise<UploadResult>` and `alarm()`
  - `type ActivityDeps = { database: () => Database; blobs: () => Blobs; writer: (userId: string) => DurableObjectStub<AthleteWriter>; userId: (request: Request) => Promise<string | undefined> }`,
    `activityRoutes(deps: ActivityDeps): Hono`, `UPLOADS_PER_WINDOW`, `CALLS_PER_WINDOW`
  - `getBlobs(): Blobs`, `writerOf(userId: string): DurableObjectStub<AthleteWriter>` in `services.ts`
  - Worker bindings `FILES` (R2) and `ATHLETES` (Durable Object namespace, class `AthleteWriter`)
  - test helpers `signUp(runtime): Promise<{ token: string; userId: string }>`, `sha256(bytes)`,
    `deviceClock(ms, counter?, deviceId?)`, `v1(runtime, token, path, init?)`,
    `uploadFit(runtime, token, bytes, query?)`, `fitKey(userId, sha256)`

- [ ] **Step 1: Bind the bucket and the writer**

Change `hosted/infra/alchemy.run.ts`:

```diff
--- a/hosted/infra/alchemy.run.ts
+++ b/hosted/infra/alchemy.run.ts
@@ -7,6 +7,7 @@ import * as Effect from "effect/Effect";
 import * as Redacted from "effect/Redacted";
 import "varlock/auto-load";

+import type { AthleteWriter } from "../apps/api/src/athletes/writer";
 import { Observability } from "./observability";

 const production = Alchemy.Stack.pipe(Effect.map(({ stage }) => stage === "production"));
@@ -23,6 +24,9 @@ export const db = Cloudflare.D1.Database("database", {
   migrations: "../apps/api/src/db/migrations",
 }).pipe(RemovalPolicy.retain(production));

+/** Riders' original FIT files, under `athletes/<userId>/`. */
+export const files = Cloudflare.R2.Bucket("files").pipe(RemovalPolicy.retain(production));
+
 export const observability = Effect.gen(function* () {
   const enabled = yield* Config.Boolean("AXIOM_ENABLED").pipe(Config.withDefault(false));
   if (!enabled) {
@@ -49,6 +53,9 @@ export const server = Cloudflare.Worker("server", {
   workersDev: serverWorkersDevForStage,
   env: {
     DB: db,
+    FILES: files,
+    /** One per rider, keyed by user ID: every write to the rider's data goes through it. */
+    ATHLETES: Cloudflare.DurableObject<AthleteWriter>("athletes", { className: "AthleteWriter" }),
     NODE_ENV: production.pipe(Effect.map((prod) => (prod ? "production" : "development"))),
     CORS_ORIGIN: production.pipe(
       Effect.flatMap((prod) =>
```

`Cloudflare.DurableObject<AthleteWriter>(name, { className })` is how Alchemy 2 binds a Durable
Object class exported by an async Worker's own module (see the "Binding in an Async Worker"
section of `node_modules/alchemy/src/Cloudflare/Workers/DurableObject.ts`). New classes get
SQLite storage by default. The type import makes `ENV.ATHLETES` a typed
`DurableObjectNamespace<AthleteWriter>` through `Cloudflare.InferEnv`, so RPC calls are checked.

Change `tests/helpers/worker.mjs`:

```diff
--- a/tests/helpers/worker.mjs
+++ b/tests/helpers/worker.mjs
@@ -35,6 +35,8 @@ export async function startWorker({ bindings = {}, outboundService } = {}) {
     compatibilityFlags: ["nodejs_compat"],
     cf: false,
     d1Databases: ["DB"],
+    r2Buckets: ["FILES"],
+    durableObjects: { ATHLETES: "AthleteWriter" },
     outboundService,
     bindings: {
       NODE_ENV: "test",
```

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

const entry = (day, ...changes) => ({ day, value: { changes } });
const setFtp = (value, scope = "all") => ({ type: "threshold", threshold: "ftp", scope, value });

test("the FTP on a day is the latest set on or before it", () => {
  const changes = ftp.ftpChanges([
    entry("2026-05-01", setFtp(260)),
    entry("2026-01-01", setFtp(240)),
  ]);
  assert.equal(ftp.ftpOn(changes, "2026-03-15"), 240);
  assert.equal(ftp.ftpOn(changes, "2026-05-01"), 260);
});

test("rides before the first zone change use that first day's zones", () => {
  const changes = ftp.ftpChanges([entry("2026-01-01", setFtp(240))]);
  assert.equal(ftp.ftpOn(changes, "2025-06-01"), 240);
});

test("when the first zone change set no FTP, earlier rides have none", () => {
  const maxHeartRate = { type: "threshold", threshold: "maxHeartRate", scope: "all", value: 190 };
  const changes = ftp.ftpChanges([
    entry("2026-01-01", maxHeartRate),
    entry("2026-02-01", setFtp(250)),
  ]);
  assert.equal(ftp.ftpOn(changes, "2025-12-01"), null);
  assert.equal(ftp.ftpOn(changes, "2026-01-15"), null);
  assert.equal(ftp.ftpOn(changes, "2026-02-01"), 250);
});

test("sport-specific FTPs are ignored, and clearing the FTP leaves none", () => {
  assert.equal(
    ftp.ftpOn(ftp.ftpChanges([entry("2026-01-01", setFtp(300, "rowing"))]), "2026-02-01"),
    null,
  );
  const cleared = ftp.ftpChanges([
    entry("2026-01-01", setFtp(240)),
    entry("2026-03-01", setFtp(null)),
  ]);
  assert.equal(ftp.ftpOn(cleared, "2026-04-01"), null);
});

test("an activity's derived values follow its time zone and the FTP of its local day", () => {
  const changes = ftp.ftpChanges([entry("2026-03-01", setFtp(250))]);
  // 23:30 UTC on the last day of February is already March in Budapest.
  const ride = {
    startDate: Date.parse("2026-02-28T23:30:00Z"),
    timezone: null,
    fitFtp: null,
    weightedAverageWatts: 200,
    movingTime: 3600,
  };
  assert.deepEqual(ftp.derive(ride, [{ day: "2026-01-01", ftp: 200 }, ...changes]), {
    startDateLocal: "2026-02-28T23:30:00",
    ftp: 200,
    intensityFactor: 1,
    trainingStress: 100,
  });
  const local = ftp.derive({ ...ride, timezone: "Europe/Budapest" }, changes);
  assert.equal(local.startDateLocal, "2026-03-01T00:30:00");
  assert.equal(local.ftp, 250);
  assert.equal(ftp.derive({ ...ride, fitFtp: 400 }, changes).ftp, 400, "the file's own FTP wins");
  assert.equal(ftp.derive({ ...ride, weightedAverageWatts: null }, changes).trainingStress, null);
});
```

- [ ] **Step 3: Implement local time, the FTP timeline and derived values**

Create `hosted/apps/api/src/activities/local-time.ts`:

```ts
import type { SportType } from "@trainstack/contract";

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
    hour >= 5 && hour < 12
      ? "Morning"
      : hour >= 12 && hour < 17
        ? "Afternoon"
        : hour >= 17 && hour < 21
          ? "Evening"
          : "Night";
  return `${part} ${NOUNS[sportType]}`;
}
```

Create `hosted/apps/api/src/activities/ftp.ts`:

```ts
import { type Derived, zoneChangeValueSchema } from "@trainstack/contract";

import { localTimestamp } from "./local-time";
import { trainingLoad } from "./metrics";

/** The Default-scope FTP from a local day on; null when that day's zones have none. */
export type FtpChange = { day: string; ftp: number | null };

/** A live zone history entry: the local day it took effect, which is its ID, and its changes. */
export type ZoneEntry = { day: string; value: unknown };

/**
 * The FTP changes in a rider's zone history, oldest first. Entries are keyed by day, so there is
 * one per day. As in Ride's `ZoneHistory`, a ride before the first entry uses that entry's zones,
 * so when the first entry sets no FTP it starts the timeline with none.
 */
export function ftpChanges(entries: ZoneEntry[]): FtpChange[] {
  const days = entries
    .flatMap(({ day, value }) => {
      const parsed = zoneChangeValueSchema.safeParse(value);
      return parsed.success ? [{ day, changes: parsed.data.changes }] : [];
    })
    .sort((a, b) => a.day.localeCompare(b.day));
  const changes: FtpChange[] = [];
  for (const { day, changes: set } of days) {
    let ftp: FtpChange | undefined;
    for (const change of set) {
      if (change.type === "threshold" && change.threshold === "ftp" && change.scope === "all") {
        ftp = { day, ftp: change.value };
      }
    }
    if (ftp) changes.push(ftp);
  }
  const first = days[0]?.day;
  if (first !== undefined && changes[0]?.day !== first) changes.unshift({ day: first, ftp: null });
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

/** What an activity's derived values come from. */
export type DeriveInput = {
  startDate: number;
  timezone: string | null;
  fitFtp: number | null;
  weightedAverageWatts: number | null;
  movingTime: number;
};

/**
 * The values the server works out for an activity: its local start, the FTP it is scored with
 * (the file's own, else the rider's on that local day) and the IF and TSS that follow.
 */
export function derive(input: DeriveInput, changes: FtpChange[]): Derived {
  const startDateLocal = localTimestamp(input.startDate, input.timezone);
  const ftp = input.fitFtp ?? ftpOn(changes, startDateLocal.slice(0, 10));
  const load = trainingLoad(input.weightedAverageWatts, ftp, input.movingTime);
  return {
    startDateLocal,
    ftp,
    intensityFactor: load?.intensityFactor ?? null,
    trainingStress: load?.trainingStress ?? null,
  };
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

/** Signs a rider up with email and returns their bearer token and user ID. */
export async function signUp(runtime) {
  const email = `athlete${++riders}-${Date.now()}@example.com`;
  const response = await runtime.dispatchFetch(`${api}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://trainstackhq.com" },
    body: JSON.stringify({ name: `Athlete ${riders}`, email, password: "test-password-12345" }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return { token: response.headers.get("set-auth-token"), userId: (await response.json()).user.id };
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

/** Uploads a FIT file the way Ride does. `sha256` overrides the path's hash. */
export function uploadFit(runtime, token, bytes, { sha256: path = sha256(bytes), ...query } = {}) {
  const params = new URLSearchParams({
    clock: deviceClock(Date.now()),
    deviceId: "device-a",
    ...query,
  });
  return v1(runtime, token, `/activities/fit/${path}?${params}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes,
  });
}

/** The key of a rider's FIT file in R2. */
export const fitKey = (userId, sha) => `athletes/${userId}/activities/${sha}.fit`;
```

Create `tests/activities.test.mjs`:

```js
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { makeFit, repeat } from "./helpers/fit.mjs";
import { deviceClock, fitKey, sha256, signUp, uploadFit, v1 } from "./helpers/riders.mjs";
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

const eventsFor = async (id) =>
  (await db.prepare("SELECT * FROM sync_event WHERE object_id = ? ORDER BY seq").bind(id).all())
    .results;

test("uploading a ride stores the file and the parsed activity", async () => {
  const { token, userId } = await signUp(runtime);
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
  assert.equal(activity.ftp, 250);
  assert.ok(Math.abs(activity.intensityFactor - 0.8) < 1e-9);
  assert.ok(Math.abs(activity.trainingStress - (120 * 200 * 0.8 * 100) / (250 * 3600)) < 1e-9);

  const stored = await bucket.get(fitKey(userId, activity.fitSha256));
  assert.deepEqual(new Uint8Array(await stored.arrayBuffer()), bytes);
  const download = await v1(runtime, token, `/activities/${activity.id}/fit`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "application/vnd.ant.fit");
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);

  const [created] = await eventsFor(activity.id);
  const updates = JSON.parse(created.updates);
  assert.equal(created.aspect_type, "create");
  assert.equal(updates.fitSha256, activity.fitSha256);
  assert.equal(updates.clocks.existence, created.clock);
  assert.equal(updates.clocks.name, "000000000000000.000000.0");
  assert.equal(
    await db.prepare("SELECT * FROM pending_blob").first(),
    null,
    "nothing left pending",
  );
});

test("uploading the same ride again changes nothing", async () => {
  const { token } = await signUp(runtime);
  const bytes = ride();
  const clock = deviceClock(Date.now());
  const first = await (await uploadFit(runtime, token, bytes, { clock })).json();
  const again = await uploadFit(runtime, token, bytes, { clock });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).id, first.id);
  const older = await uploadFit(runtime, token, bytes, { clock: deviceClock(Date.now() - 60_000) });
  assert.equal(older.status, 200);
  assert.equal((await eventsFor(first.id)).length, 1);
});

test("a newer upload of a live ride moves its existence clock on", async () => {
  const { token } = await signUp(runtime);
  const bytes = ride();
  const t = Date.now();
  const first = await (
    await uploadFit(runtime, token, bytes, { clock: deviceClock(t - 1000) })
  ).json();
  const newer = await uploadFit(runtime, token, bytes, { clock: deviceClock(t, 0, "device-b") });
  assert.equal(newer.status, 200);
  const row = await db
    .prepare("SELECT existence_clock FROM activity WHERE id = ?")
    .bind(first.id)
    .first();
  assert.equal(row.existence_clock, deviceClock(t, 0, "device-b"));
  assert.deepEqual(
    (await eventsFor(first.id)).map((e) => e.aspect_type),
    ["create", "create"],
  );
});

test("the same ride uploaded twice at once is one activity", async () => {
  const { token } = await signUp(runtime);
  const bytes = ride();
  const clock = deviceClock(Date.now());
  const responses = await Promise.all([
    uploadFit(runtime, token, bytes, { clock }),
    uploadFit(runtime, token, bytes, { clock }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 201]);
  const rows = await db
    .prepare("SELECT id FROM activity WHERE fit_sha256 = ?")
    .bind(sha256(bytes))
    .all();
  assert.equal(rows.results.length, 1);
  assert.equal((await eventsFor(rows.results[0].id)).length, 1);
});

test("a file left by an upload that never wrote its row is swept away", async () => {
  const { token, userId } = await signUp(runtime);
  const orphan = "f".repeat(64);
  await bucket.put(fitKey(userId, orphan), new Uint8Array([1, 2, 3]));
  await db
    .prepare("INSERT INTO pending_blob (user_id, fit_sha256, created_at) VALUES (?, ?, ?)")
    .bind(userId, orphan, Date.now())
    .run();
  assert.equal((await uploadFit(runtime, token, ride())).status, 201);
  assert.equal(await bucket.get(fitKey(userId, orphan)), null);
  assert.equal(
    await db.prepare("SELECT * FROM pending_blob WHERE user_id = ?").bind(userId).first(),
    null,
  );
});

test("a ride without a timezone uses UTC for its local time", async () => {
  const { token } = await signUp(runtime);
  const activity = await (await uploadFit(runtime, token, ride())).json();
  assert.equal(activity.timezone, null);
  assert.equal(activity.startDateLocal.slice(11), "07:00:00");
});

test("a body that does not match its hash is refused and nothing is stored", async () => {
  const { token, userId } = await signUp(runtime);
  const response = await uploadFit(runtime, token, ride(), { sha256: "0".repeat(64) });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, "hash_mismatch");
  assert.equal((await bucket.list({ prefix: `athletes/${userId}/` })).objects.length, 0);
});

test("a file that is not a FIT activity is refused with the reason", async () => {
  const { token } = await signUp(runtime);
  for (const bytes of [new Uint8Array([1, 2, 3, 4, 5]), ride({ sessions: 2 })]) {
    const response = await uploadFit(runtime, token, bytes);
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.error, "invalid_fit");
    assert.ok(body.message);
  }
});

test("bad clocks, devices and timezones are refused before the body is read", async () => {
  const { token } = await signUp(runtime);
  const bytes = ride();
  for (const query of [
    { clock: "nonsense" },
    { clock: deviceClock(Date.now() + 11 * 60_000) },
    { deviceId: "has spaces" },
    { deviceId: "server" },
    { timezone: "Mars/Olympus_Mons" },
  ]) {
    const response = await uploadFit(runtime, token, bytes, query);
    assert.equal(response.status, 400, JSON.stringify(query));
  }
});

test("bodies over 10 MB are refused", async () => {
  const { token } = await signUp(runtime);
  const big = new Uint8Array(10 * 1024 * 1024 + 1);
  const response = await uploadFit(runtime, token, big);
  assert.equal(response.status, 413);
});

test("uploads need a session, and riders cannot read each other's files", async () => {
  const bytes = ride();
  assert.equal((await uploadFit(runtime, null, bytes)).status, 401);
  const owner = await signUp(runtime);
  const other = await signUp(runtime);
  const activity = await (await uploadFit(runtime, owner.token, bytes)).json();
  assert.equal((await v1(runtime, other.token, `/activities/${activity.id}/fit`)).status, 404);
  // The same file uploaded by another rider is their own activity.
  const theirs = await uploadFit(runtime, other.token, bytes);
  assert.equal(theirs.status, 201);
  assert.notEqual((await theirs.json()).id, activity.id);
});

test("a rider's uploads are limited to 60 every 15 minutes", async () => {
  const { token, userId } = await signUp(runtime);
  await db
    .prepare("INSERT INTO rate_budget (key, window_start, used) VALUES (?, ?, 60)")
    .bind(`upload:${userId}`, Math.floor(Date.now() / 1000))
    .run();
  assert.equal((await uploadFit(runtime, token, ride())).status, 429);
});
```

Run: `node --test tests/activities.test.mjs`
Expected: FAIL (the worker does not start: it exports no `AthleteWriter` yet).

- [ ] **Step 5: Implement storage**

Create `hosted/apps/api/src/storage/index.ts`:

```ts
/// <reference types="@cloudflare/workers-types" />

/** Where riders' files are kept. R2 on Workers; the interface keeps self-hosting open. */
export type Blobs = {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array<ArrayBuffer> | undefined>;
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

- [ ] **Step 6: Implement the activity shapes**

Create `hosted/apps/api/src/activities/shape.ts`:

```ts
import type { ManifestActivity, SportType, SummaryActivity } from "@trainstack/contract";

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
    ftp: row.ftp,
    trainingStress: row.trainingStress,
    intensityFactor: row.intensityFactor,
    workoutName: row.workoutName,
    fitSha256: row.fitSha256,
  };
}

/** The whole state of an activity, as the manifest lists it and its `create` event carries it. */
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
      timezone: row.timezoneClock,
      existence: row.existenceClock,
    },
  };
}
```

- [ ] **Step 7: Implement the writer's building blocks**

Create `hosted/apps/api/src/sync/writer.ts`:

```ts
import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Database } from "../db";
import { activity, pendingBlob, syncState } from "../db/schema";
import { type Blobs, fitKey } from "../storage";
import { nextClock, ZERO_CLOCK } from "./clock";

/**
 * One operation on a rider's data. Only the rider's `AthleteWriter` makes these, and it runs one
 * at a time, so an operation can read rows and write them back without another write between.
 */
export type Writer = {
  db: Database;
  blobs: Blobs;
  userId: string;
  /** When the operation started, in milliseconds since the epoch. */
  now: number;
  /** The rider's hybrid logical clock: the highest clock the server has made or seen for them. */
  clock: string;
};

export type Statement = BatchItem<"sqlite">;

export type NewEvent = {
  objectType: "activity" | "settings";
  objectId: string;
  aspectType: "create" | "update" | "delete";
  updates: Record<string, unknown> | null;
  clock: string;
  deviceId: string;
};

/** The device ID of changes the server makes itself. */
export const SERVER = "server";

export async function openWriter(db: Database, blobs: Blobs, userId: string, now: number) {
  const state = await db
    .select({ clock: syncState.clock })
    .from(syncState)
    .where(eq(syncState.userId, userId))
    .get();
  return { db, blobs, userId, now, clock: state?.clock ?? ZERO_CLOCK } satisfies Writer;
}

/** Moves the rider's clock past a clock the server received. */
export function see(writer: Writer, clock: string) {
  if (clock > writer.clock) writer.clock = clock;
}

/** A clock for a change the server makes, later than every clock it has seen for the rider. */
export function serverClock(writer: Writer) {
  writer.clock = nextClock(writer.clock, writer.now, SERVER);
  return writer.clock;
}

/** Runs `statements` as one transaction, and saves the rider's clock with them. */
export async function commit(writer: Writer, statements: Statement[]) {
  const saveClock = writer.db
    .insert(syncState)
    .values({ userId: writer.userId, prunedThrough: 0, clock: writer.clock })
    .onConflictDoUpdate({ target: syncState.userId, set: { clock: writer.clock } });
  const batch: [Statement, ...Statement[]] = [saveClock, ...statements];
  await writer.db.batch(batch);
}

/** About 256 KB of JSON per bound value, well under D1's 2 MB limit for one. */
const MAX_CHUNK_LENGTH = 256 * 1024;

/**
 * `items` as JSON arrays to bind to `json_each`, so that one statement writes many rows: D1
 * allows 100 bound values a statement, and a batch of a statement a row would be long.
 */
export function jsonChunks(items: unknown[]): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  for (const item of items) {
    const json = JSON.stringify(item);
    if (current.length > 0 && length + json.length > MAX_CHUNK_LENGTH) {
      chunks.push(`[${current.join(",")}]`);
      current = [];
      length = 0;
    }
    current.push(json);
    length += json.length;
  }
  if (current.length > 0) chunks.push(`[${current.join(",")}]`);
  return chunks;
}

/** Appends `events` to the rider's log, in order. */
export const insertEvents = (writer: Writer, events: NewEvent[]): Statement[] =>
  jsonChunks(events).map((items) =>
    writer.db.run(sql`
      INSERT INTO sync_event
        (user_id, object_type, object_id, aspect_type, updates, clock, device_id, created_at)
      SELECT ${writer.userId}, j.value ->> '$.objectType', j.value ->> '$.objectId',
        j.value ->> '$.aspectType', nullif(j.value -> '$.updates', 'null'),
        j.value ->> '$.clock', j.value ->> '$.deviceId', ${writer.now}
      FROM json_each(${items}) AS j
      ORDER BY j.key
    `),
  );

/** Marks the files of `sha256s` as possibly not matching their rows, for `sweep` to settle. */
export const markPending = (writer: Writer, sha256s: string[]): Statement[] =>
  jsonChunks(sha256s).map((items) =>
    writer.db.run(sql`
      INSERT INTO pending_blob (user_id, fit_sha256, created_at)
      SELECT ${writer.userId}, j.value, ${writer.now} FROM json_each(${items}) AS j WHERE true
      ON CONFLICT DO NOTHING
    `),
  );

/** The mark on a file whose row now matches it. */
export const clearPending = (writer: Writer, sha256: string): Statement =>
  writer.db
    .delete(pendingBlob)
    .where(and(eq(pendingBlob.userId, writer.userId), eq(pendingBlob.fitSha256, sha256)));

/**
 * Makes R2 agree with D1 for every file marked pending: the file of a live ride stays, any other
 * is deleted, then the mark goes. Safe to run again after any failure, and it is: after every
 * operation and from the writer's alarm.
 */
export async function sweep(writer: Writer) {
  const files = await writer.db
    .select({ sha256: pendingBlob.fitSha256, id: activity.id, deletedAt: activity.deletedAt })
    .from(pendingBlob)
    .leftJoin(
      activity,
      and(eq(activity.userId, pendingBlob.userId), eq(activity.fitSha256, pendingBlob.fitSha256)),
    )
    .where(eq(pendingBlob.userId, writer.userId));
  for (const file of files) {
    if (file.id === null || file.deletedAt !== null) {
      await writer.blobs.delete(fitKey(writer.userId, file.sha256));
    }
    await clearPending(writer, file.sha256);
  }
}
```

Statements that write many rows bind one JSON array to `json_each` instead of one statement per
row: D1 allows 100 bound values per statement, and the batch for a large push or recompute would
otherwise run to thousands of statements. `->>` extracts SQL values, `->` keeps JSON, and
`nullif(..., 'null')` turns a JSON null into SQL NULL for the JSON columns.

Create `hosted/apps/api/src/activities/training.ts`:

```ts
import { and, eq, isNull } from "drizzle-orm";

import { settingsEntry } from "../db/schema";
import type { Writer } from "../sync/writer";
import { type ZoneEntry } from "./ftp";

/** The rider's live zone history entries. */
export async function loadZoneEntries(writer: Writer): Promise<ZoneEntry[]> {
  return writer.db
    .select({ day: settingsEntry.entryId, value: settingsEntry.value })
    .from(settingsEntry)
    .where(
      and(
        eq(settingsEntry.userId, writer.userId),
        eq(settingsEntry.kind, "zone_change"),
        isNull(settingsEntry.deletedAt),
      ),
    );
}
```

- [ ] **Step 8: Implement storing an upload**

Create `hosted/apps/api/src/activities/store.ts`:

```ts
import type { SummaryActivity } from "@trainstack/contract";
import { and, eq } from "drizzle-orm";

import { activity, type ActivityRow } from "../db/schema";
import { newId } from "../ids";
import { fitKey } from "../storage";
import { ZERO_CLOCK } from "../sync/clock";
import {
  clearPending,
  commit,
  insertEvents,
  markPending,
  type NewEvent,
  see,
  type Writer,
} from "../sync/writer";
import type { ParsedActivity } from "./fit";
import { derive, ftpChanges } from "./ftp";
import { defaultName } from "./local-time";
import { toManifestActivity, toSummary } from "./shape";
import { loadZoneEntries } from "./training";

export type UploadInput = {
  sha256: string;
  fit: Uint8Array;
  parsed: ParsedActivity;
  clock: string;
  deviceId: string;
  timezone: string | null;
  externalId: string | null;
};

export type UploadResult = {
  /**
   * `existing`: the ride was live already. `deleted`: it was deleted after the upload's clock,
   * so it stays deleted.
   */
  kind: "created" | "restored" | "existing" | "deleted";
  activity: SummaryActivity;
};

const findByHash = (writer: Writer, sha256: string) =>
  writer.db
    .select()
    .from(activity)
    .where(and(eq(activity.userId, writer.userId), eq(activity.fitSha256, sha256)))
    .get();

/** The event that tells devices an activity exists, with everything about it and every clock. */
const createdEvent = (row: ActivityRow, deviceId: string): NewEvent => ({
  objectType: "activity",
  objectId: row.id,
  aspectType: "create",
  updates: toManifestActivity(row),
  clock: row.existenceClock,
  deviceId,
});

/** Writes the file before the row that will point at it, marked pending until that row is. */
async function storeFile(writer: Writer, input: UploadInput) {
  await commit(writer, markPending(writer, [input.sha256]));
  await writer.blobs.put(fitKey(writer.userId, input.sha256), input.fit);
}

/**
 * Keeps an uploaded ride. Whether it exists is a last-write-wins register: an upload newer than
 * the ride's existence clock makes it live, even when it is live already, and one that is not
 * newer changes nothing. A restored ride keeps its newest edits, which its `create` event carries
 * with their own clocks.
 */
export async function storeUpload(writer: Writer, input: UploadInput): Promise<UploadResult> {
  see(writer, input.clock);
  const existing = await findByHash(writer, input.sha256);
  if (existing && input.clock <= existing.existenceClock) {
    const kind = existing.deletedAt === null ? "existing" : "deleted";
    return { kind, activity: toSummary(existing) };
  }
  if (existing) {
    const restoring = existing.deletedAt !== null;
    if (restoring) await storeFile(writer, input);
    const row = { ...existing, deletedAt: null, existenceClock: input.clock };
    await commit(writer, [
      writer.db
        .update(activity)
        .set({ deletedAt: null, existenceClock: input.clock })
        .where(eq(activity.id, row.id)),
      ...insertEvents(writer, [createdEvent(row, input.deviceId)]),
      clearPending(writer, input.sha256),
    ]);
    return { kind: restoring ? "restored" : "existing", activity: toSummary(row) };
  }

  await storeFile(writer, input);
  const { parsed } = input;
  const derived = derive(
    { ...parsed, timezone: input.timezone },
    ftpChanges(await loadZoneEntries(writer)),
  );
  const row: ActivityRow = {
    id: newId("act", writer.now),
    userId: writer.userId,
    fitSha256: input.sha256,
    source: parsed.source,
    externalId: input.externalId,
    startDate: parsed.startDate,
    timezone: input.timezone,
    timezoneClock: ZERO_CLOCK,
    ...derived,
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
    name: parsed.workoutName ?? defaultName(parsed.sportType, derived.startDateLocal),
    nameClock: ZERO_CLOCK,
    description: null,
    descriptionClock: ZERO_CLOCK,
    sportType: parsed.sportType,
    sportTypeClock: ZERO_CLOCK,
    hidden: false,
    hiddenClock: ZERO_CLOCK,
    deletedAt: null,
    existenceClock: input.clock,
    createdAt: new Date(writer.now),
    updatedAt: new Date(writer.now),
  };
  await commit(writer, [
    writer.db.insert(activity).values(row),
    ...insertEvents(writer, [createdEvent(row, input.deviceId)]),
    clearPending(writer, input.sha256),
  ]);
  return { kind: "created", activity: toSummary(row) };
}
```

The `create` event is built from the row the writer read and is about to write, inside the
operation, so it carries each field with its real clock: an edit cannot land between the read and
the write.

- [ ] **Step 9: Implement the writer**

Create `hosted/apps/api/src/athletes/writer.ts`:

```ts
import { DurableObject } from "cloudflare:workers";

import { storeUpload, type UploadInput, type UploadResult } from "../activities/store";
import { getBlobs, getDb } from "../services";
import { openWriter, sweep, type Writer } from "../sync/writer";

/** How long after an operation its sweep runs again, in case the operation never finished. */
const SWEEP_DELAY_MS = 10 * 60 * 1000;

/**
 * The one place a rider's data is written. Cloudflare runs at most one instance of this object
 * per rider, and its queue runs their operations one at a time, so each operation reads the
 * rider's rows and writes them back with no other write in between. D1 stays the store of
 * record: the object keeps only its alarm and the rider's ID for it.
 */
export class AthleteWriter extends DurableObject {
  #queue: Promise<unknown> = Promise.resolve();
  #userId: string | undefined;

  /** Runs `task` once every operation queued before it has finished. */
  #serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(task);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  /**
   * Runs an operation on the rider's data. An alarm is set first, so a file an operation leaves
   * behind is swept even if this instance dies, and a sweep runs after, so it usually goes at once.
   */
  #run<T>(userId: string, task: (writer: Writer) => Promise<T>): Promise<T> {
    return this.#serialize(async () => {
      if (this.#userId !== userId) {
        await this.ctx.storage.put("userId", userId);
        this.#userId = userId;
      }
      if ((await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.storage.setAlarm(Date.now() + SWEEP_DELAY_MS);
      }
      const writer = await openWriter(getDb(), getBlobs(), userId, Date.now());
      try {
        return await task(writer);
      } finally {
        await sweep(writer).catch((error) => console.error(error));
      }
    });
  }

  upload(userId: string, input: UploadInput): Promise<UploadResult> {
    return this.#run(userId, (writer) => storeUpload(writer, input));
  }

  async alarm() {
    await this.#serialize(async () => {
      const userId = await this.ctx.storage.get<string>("userId");
      if (userId) await sweep(await openWriter(getDb(), getBlobs(), userId, Date.now()));
    });
  }
}
```

The queue is what serializes operations: a Durable Object does not process one event at a time
while it awaits D1 or R2, so without it two operations could still interleave. Cloudflare runs at
most one instance per rider, so an in-memory queue is enough.

- [ ] **Step 10: Implement the routes**

Create `hosted/apps/api/src/activities/routes.ts`:

```ts
import { deviceIdSchema, isTimeZone } from "@trainstack/contract";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

import type { AthleteWriter } from "../athletes/writer";
import { createBudget } from "../budget";
import type { Database } from "../db";
import { activity } from "../db/schema";
import { MAX_FIT_BYTES, readBody } from "../http";
import { type Blobs, fitKey } from "../storage";
import { clockProblem } from "../sync/clock";
import { InvalidFit, parseFit } from "./fit";

export type ActivityDeps = {
  database: () => Database;
  blobs: () => Blobs;
  writer: (userId: string) => DurableObjectStub<AthleteWriter>;
  /** The signed-in rider's ID, if the request carries a session. */
  userId: (request: Request) => Promise<string | undefined>;
};

export const UPLOADS_PER_WINDOW = 60;
export const CALLS_PER_WINDOW = 300;
const SHA256 = /^[0-9a-f]{64}$/;

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
    if (!deviceIdSchema.safeParse(deviceId).success) {
      return c.json({ error: "invalid_device" }, 400);
    }
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
    // Parsed here, where CPU is plentiful; stored by the rider's writer, one change at a time.
    const result = await deps
      .writer(userId)
      .upload(userId, { sha256, fit, parsed, clock, deviceId, timezone, externalId });
    if (result.kind === "deleted") {
      return c.json({ error: "deleted", activity: result.activity }, 409);
    }
    return c.json(result.activity, result.kind === "existing" ? 200 : 201);
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
    // A delete can land between reading the row and the file.
    const bytes = row && (await deps.blobs().get(fitKey(userId, row.sha256)));
    if (!bytes) return c.json({ error: "not_found" }, 404);
    return c.body(bytes, 200, { "Content-Type": "application/vnd.ant.fit" });
  });

  return app;
}
```

Replace `hosted/apps/api/src/services.ts` with:

```ts
import { createAuth as createConfiguredAuth } from "./auth";
import { type Database, createDb } from "./db";

import { ENV } from "./env.server";
import { type Blobs, r2Blobs } from "./storage";

export function getDb(): Database {
  return createDb(ENV);
}
export async function createAuth(database?: Database) {
  return createConfiguredAuth(ENV, database ?? (await getDb()));
}
export function getBlobs(): Blobs {
  return r2Blobs(ENV.FILES);
}
/** The rider's writer: every change to their data goes through it, one at a time. */
export function writerOf(userId: string) {
  return ENV.ATHLETES.getByName(userId);
}
```

- [ ] **Step 11: Mount the routes and export the writer**

Change `hosted/apps/api/src/index.ts`:

```diff
--- a/hosted/apps/api/src/index.ts
+++ b/hosted/apps/api/src/index.ts
@@ -10,10 +10,11 @@ import { evlog, type EvlogVariables } from "evlog/hono";
 import { Hono } from "hono";
 import { cors } from "hono/cors";

+import { activityRoutes } from "./activities/routes";
 import { createContext } from "./context";
 import { ENV } from "./env.server";
 import { appRouter } from "./router";
-import { createAuth, getDb } from "./services";
+import { createAuth, getBlobs, getDb, writerOf } from "./services";
 import { stravaRoutes } from "./strava";

 initLogger({
@@ -48,7 +49,7 @@ app.use(
   "/*",
   cors({
     origin: ENV.CORS_ORIGIN,
-    allowMethods: ["GET", "POST", "OPTIONS"],
+    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
     allowHeaders: ["Content-Type", "Authorization"],
     credentials: true,
   }),
@@ -65,13 +66,18 @@ app.get("/health", async (c) => {
   }
 });

+const sessionUserId = async (request: Request) =>
+  (await (await createAuth()).api.getSession({ headers: request.headers }))?.user.id;
+
+app.route("/strava", stravaRoutes({ env: ENV, database: getDb, userId: sessionUserId }));
+
 app.route(
-  "/strava",
-  stravaRoutes({
-    env: ENV,
+  "/v1",
+  activityRoutes({
     database: getDb,
-    userId: async (request) =>
-      (await (await createAuth()).api.getSession({ headers: request.headers }))?.user.id,
+    blobs: getBlobs,
+    writer: writerOf,
+    userId: sessionUserId,
   }),
 );

@@ -126,4 +132,6 @@ app.get("/", (c) => {
   return c.text("OK");
 });

+export { AthleteWriter } from "./athletes/writer";
+
 export default app;
```

The Worker module must export `AthleteWriter` by that name: it is the class the binding names.

- [ ] **Step 12: Run the tests**

Run: `bun run format && node --test tests/activities.test.mjs tests/ftp.test.mjs tests/strava.test.mjs tests/worker.test.mjs && bun run check-types`
Expected: PASS, including `hosted/infra`'s type check.

- [ ] **Step 13: Commit**

```bash
git add hosted/infra/alchemy.run.ts hosted/apps/api/src/storage hosted/apps/api/src/activities \
  hosted/apps/api/src/sync/writer.ts hosted/apps/api/src/athletes hosted/apps/api/src/services.ts \
  hosted/apps/api/src/index.ts tests/helpers/worker.mjs tests/helpers/riders.mjs \
  tests/ftp.test.mjs tests/activities.test.mjs
git commit -m "api, infra: keep uploaded rides through a writer per rider and serve their FIT files"
```

---

### Task 7: Pushing changes, and the `/v1` JSON API

**Files:**

- Create: `hosted/apps/api/src/sync/apply.ts`
- Modify: `hosted/apps/api/src/athletes/writer.ts`
- Modify: `hosted/apps/api/src/http.ts`
- Modify: `hosted/apps/api/src/index.ts` (cap JSON bodies, mount a second `OpenAPIHandler` at `/v1`)
- Modify: `hosted/apps/api/src/router.ts`
- Test: `tests/sync.test.mjs`

**Interfaces:**

- Consumes: `Writer`, `commit`, `insertEvents`, `jsonChunks`, `markPending`, `see`,
  `serverClock`, `SERVER`, `loadZoneEntries`, `derive`, `ftpChanges` (Task 6); `clockProblem`
  (Task 2); `syncChangeSchema`, `SyncChange`, `ChangeResult`, `ChangeProblem` (Task 4).
- Produces:
  - `type ActivityUpdate = Extract<SyncChange, { objectType: "activity"; op: "update" }>`,
    `applyChanges(writer: Writer, deviceId: string, changes: SyncChange[]): Promise<ChangeResult[]>`
  - `AthleteWriter.applyChanges(userId: string, deviceId: string, changes: SyncChange[]): Promise<ChangeResult[]>`
  - `MAX_JSON_BYTES`, `boundedRequest(request: Request, limit: number): Promise<Request | undefined>`
  - `v1Handler`; oRPC procedure `sync.push` reachable at `POST /v1/sync/changes`.

A push runs as one unit of work: `applyChanges` reads every row the push touches, applies the
changes in order to those rows in memory, recomputes derived values where a zone change or a
time zone change moved them, and writes rows, events and file marks in one `commit`. A push is
applied whole or not at all, so its recovery from any failure is the device sending it again.

- [ ] **Step 1: Write the failing sync tests**

Create `tests/sync.test.mjs`:

```js
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { makeFit, repeat } from "./helpers/fit.mjs";
import { deviceClock, fitKey, signUp, uploadFit, v1 } from "./helpers/riders.mjs";
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
const setting = (kind, entryId, value, clock) => ({
  changeId: `c${++changes}`,
  objectType: "settings",
  kind,
  entryId,
  op: value === undefined ? "delete" : "put",
  ...(value === undefined ? {} : { value }),
  clock,
});
const ftpOn = (day, ftp, clock) =>
  setting(
    "zone_change",
    day,
    { changes: [{ type: "threshold", threshold: "ftp", scope: "all", value: ftp }] },
    clock,
  );

async function push(token, deviceId, list) {
  const response = await v1(runtime, token, "/sync/changes", {
    method: "POST",
    json: { deviceId, changes: list },
  });
  return { status: response.status, body: await response.json() };
}

const statuses = (result) => result.body.results.map((r) => r.status);
const row = (id) => db.prepare("SELECT * FROM activity WHERE id = ?").bind(id).first();
const eventsFor = async (id) =>
  (
    await db.prepare("SELECT * FROM sync_event WHERE object_id = ? ORDER BY seq").bind(id).all()
  ).results.map((event) => ({ ...event, updates: JSON.parse(event.updates) }));

/** A rider with one uploaded ride. */
async function riderWithRide(options) {
  const rider = await signUp(runtime);
  const response = await uploadFit(runtime, rider.token, ride(options), {
    clock: deviceClock(Date.now() - 60_000),
  });
  return { ...rider, activity: await response.json() };
}

test("edits to different fields on two devices both survive", async () => {
  const { token, activity } = await riderWithRide();
  const t = Date.now();
  const a = await push(token, "device-a", [
    update(activity.id, { name: "Hill repeats" }, deviceClock(t, 0, "device-a")),
  ]);
  const b = await push(token, "device-b", [
    update(activity.id, { sportType: "Ride" }, deviceClock(t - 1000, 0, "device-b")),
  ]);
  assert.deepEqual(statuses(a), ["applied"]);
  assert.deepEqual(statuses(b), ["applied"]);
  const stored = await row(activity.id);
  assert.equal(stored.name, "Hill repeats");
  assert.equal(stored.sport_type, "Ride");
});

test("the later edit of a field wins, whichever arrives first", async () => {
  const { token, activity } = await riderWithRide();
  const t = Date.now();
  await push(token, "device-b", [
    update(activity.id, { name: "Newer" }, deviceClock(t, 0, "device-b")),
  ]);
  const older = await push(token, "device-a", [
    update(activity.id, { name: "Older" }, deviceClock(t - 5000, 0, "device-a")),
  ]);
  assert.deepEqual(statuses(older), ["superseded"]);
  assert.equal((await row(activity.id)).name, "Newer");
  const names = (await eventsFor(activity.id))
    .filter((e) => e.aspect_type === "update")
    .map((e) => e.updates.fields.name);
  assert.deepEqual(names, ["Newer"], "a superseded change leaves no event");
});

test("the same moment on two devices goes to the larger device ID", async () => {
  const { token, activity } = await riderWithRide();
  const t = Date.now();
  await push(token, "device-b", [
    update(activity.id, { name: "From B" }, deviceClock(t, 0, "device-b")),
  ]);
  await push(token, "device-a", [
    update(activity.id, { name: "From A" }, deviceClock(t, 0, "device-a")),
  ]);
  assert.equal((await row(activity.id)).name, "From B");
});

test("a change sent again, even at the same time, is applied once", async () => {
  const { token, activity } = await riderWithRide();
  const change = update(activity.id, { hidden: true }, deviceClock(Date.now()));
  const [first, second] = await Promise.all([
    push(token, "device-a", [change]),
    push(token, "device-a", [change]),
  ]);
  assert.deepEqual([...statuses(first), ...statuses(second)], ["applied", "applied"]);
  assert.deepEqual(statuses(await push(token, "device-a", [change])), ["applied"]);
  const updates = (await eventsFor(activity.id)).filter((e) => e.aspect_type === "update");
  assert.equal(updates.length, 1);
});

test("a clock already stored keeps what it stored, whatever a change with it carries", async () => {
  const { token, activity } = await riderWithRide();
  const clock = deviceClock(Date.now());
  await push(token, "device-a", [update(activity.id, { name: "First" }, clock)]);
  const again = await push(token, "device-a", [update(activity.id, { name: "Second" }, clock)]);
  assert.deepEqual(statuses(again), ["applied"]);
  assert.equal((await row(activity.id)).name, "First");
});

test("a delete beats earlier edits, removes the file, and later edits do not bring the ride back", async () => {
  const { token, userId, activity } = await riderWithRide();
  const t = Date.now();
  await push(token, "device-a", [remove(activity.id, deviceClock(t))]);
  assert.ok((await row(activity.id)).deleted_at);
  assert.equal(await bucket.get(fitKey(userId, activity.fitSha256)), null);
  const late = await push(token, "device-b", [
    update(activity.id, { name: "Renamed" }, deviceClock(t + 1000, 0, "device-b")),
  ]);
  assert.deepEqual(statuses(late), ["applied"]);
  const stored = await row(activity.id);
  assert.ok(stored.deleted_at, "still deleted");
  assert.equal(stored.name, "Renamed");
});

test("uploading a deleted ride again restores it with its newest edits and their own clocks", async () => {
  const { token, userId } = await signUp(runtime);
  const bytes = ride();
  const t = Date.now();
  const activity = await (
    await uploadFit(runtime, token, bytes, { clock: deviceClock(t - 3000) })
  ).json();
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
  assert.ok(await bucket.get(fitKey(userId, activity.fitSha256)), "the file is back");
  const create = (await eventsFor(activity.id)).at(-1);
  assert.equal(create.aspect_type, "create");
  assert.equal(create.updates.name, "Kept");
  assert.equal(create.updates.clocks.name, deviceClock(t - 2000), "the name keeps its own clock");
  assert.equal(create.updates.clocks.existence, deviceClock(t));
});

test("whether a ride exists does not depend on the order uploads and deletes arrive in", async () => {
  const t = Date.now();
  for (const order of ["upload first", "delete first", "together"]) {
    const { token, userId } = await signUp(runtime);
    const bytes = ride();
    const activity = await (
      await uploadFit(runtime, token, bytes, { clock: deviceClock(t - 3000) })
    ).json();
    const upload = () => uploadFit(runtime, token, bytes, { clock: deviceClock(t, 0, "device-b") });
    const del = () => push(token, "device-a", [remove(activity.id, deviceClock(t - 1000))]);
    if (order === "upload first") {
      await upload();
      await del();
    } else if (order === "delete first") {
      await del();
      await upload();
    } else {
      await Promise.all([upload(), del()]);
    }
    const stored = await row(activity.id);
    assert.equal(stored.deleted_at, null, order);
    assert.equal(stored.existence_clock, deviceClock(t, 0, "device-b"), order);
    assert.ok(await bucket.get(fitKey(userId, activity.fitSha256)), `${order}: the file is kept`);
  }
});

test("changes to rides the server does not have are reported, not fatal", async () => {
  const { token } = await signUp(runtime);
  const result = await push(token, "device-a", [
    update("act_missing", { name: "x" }, deviceClock(Date.now())),
  ]);
  assert.equal(result.status, 200);
  assert.deepEqual(statuses(result), ["unknown_object"]);
});

test("another rider's ride is unknown", async () => {
  const { activity } = await riderWithRide();
  const other = await signUp(runtime);
  const result = await push(other.token, "device-a", [
    update(activity.id, { name: "Mine now" }, deviceClock(Date.now())),
  ]);
  assert.deepEqual(statuses(result), ["unknown_object"]);
  assert.notEqual((await row(activity.id)).name, "Mine now");
});

test("malformed changes are refused whole, each reported by index", async () => {
  const { token, activity } = await riderWithRide();
  const result = await push(token, "device-a", [
    update(activity.id, { name: "Fine" }, deviceClock(Date.now())),
    update(activity.id, { name: "Future" }, deviceClock(Date.now() + 11 * 60_000)),
    update(activity.id, { distance: 1 }, deviceClock(Date.now())),
    { ...update(activity.id, { name: "x" }, "1") },
    setting("preference", "notes", "x".repeat(20_000), deviceClock(Date.now())),
  ]);
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "INVALID_CHANGES");
  assert.deepEqual(
    result.body.data.problems.map(({ index, reason }) => ({ index, reason })),
    [
      { index: 1, reason: "clock_ahead" },
      { index: 2, reason: "invalid_change" },
      { index: 3, reason: "invalid_change" },
      { index: 4, reason: "invalid_change" },
    ],
  );
  assert.ok(result.body.data.problems.every((problem) => problem.message));
  assert.notEqual((await row(activity.id)).name, "Fine");
});

test("a push that is not { deviceId, changes } is a plain bad request", async () => {
  const { token } = await signUp(runtime);
  const result = await push(token, "server", []);
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "BAD_REQUEST");
});

test("a push body over 1 MB is refused before it is parsed", async () => {
  const { token } = await signUp(runtime);
  const response = await v1(runtime, token, "/sync/changes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: "device-a", changes: [], padding: "x".repeat(1024 * 1024) }),
  });
  assert.equal(response.status, 413);
});

test("pushing needs a session", async () => {
  const result = await push(null, "device-a", []);
  assert.equal(result.status, 401);
});

test("settings entries sync whole, with tombstones", async () => {
  const { token, userId } = await signUp(runtime);
  const t = Date.now();
  await push(token, "device-a", [setting("preference", "units", "metric", deviceClock(t - 2000))]);
  await push(token, "device-b", [
    setting("preference", "units", undefined, deviceClock(t - 1000, 0, "device-b")),
  ]);
  const stale = await push(token, "device-a", [
    setting("preference", "units", "imperial", deviceClock(t - 1500)),
  ]);
  assert.deepEqual(statuses(stale), ["superseded"]);
  const entry = await db
    .prepare("SELECT * FROM settings_entry WHERE user_id = ? AND entry_id = 'units'")
    .bind(userId)
    .first();
  assert.ok(entry.deleted_at);
  assert.equal(entry.value, null);
});

test("two devices changing zones on the same day settle on the later change", async () => {
  const { token, userId } = await signUp(runtime);
  const t = Date.now();
  await push(token, "device-a", [ftpOn("2026-03-10", 250, deviceClock(t, 0, "device-a"))]);
  await push(token, "device-b", [ftpOn("2026-03-10", 260, deviceClock(t - 1000, 0, "device-b"))]);
  const entries = await db
    .prepare(
      "SELECT entry_id, value FROM settings_entry WHERE user_id = ? AND kind = 'zone_change'",
    )
    .bind(userId)
    .all();
  assert.equal(entries.results.length, 1);
  assert.equal(JSON.parse(entries.results[0].value).changes[0].value, 250);
});

test("a zone change setting FTP recomputes IF and TSS for devices too, and removing it reverts them", async () => {
  const { token, activity } = await riderWithRide();
  assert.equal(activity.trainingStress, null, "no FTP yet");
  const day = activity.startDateLocal.slice(0, 10);
  const t = Date.now();
  await push(token, "device-a", [ftpOn(day, 250, deviceClock(t - 2000))]);
  let stored = await row(activity.id);
  assert.equal(stored.ftp, 250);
  assert.ok(
    Math.abs(stored.training_stress - (3600 * 200 * 200 * 100) / (250 * 250 * 3600)) < 1e-9,
  );
  const derived = (await eventsFor(activity.id)).at(-1);
  assert.equal(derived.device_id, "server");
  assert.deepEqual(derived.updates, {
    derived: {
      startDateLocal: activity.startDateLocal,
      ftp: 250,
      intensityFactor: 0.8,
      trainingStress: stored.training_stress,
    },
  });
  await push(token, "device-a", [setting("zone_change", day, undefined, deviceClock(t - 1000))]);
  stored = await row(activity.id);
  assert.equal(stored.ftp, null);
  assert.equal(stored.training_stress, null);
  assert.equal((await eventsFor(activity.id)).at(-1).updates.derived.trainingStress, null);
});

test("an upload racing a zone change is scored with it either way", async () => {
  const { token } = await signUp(runtime);
  const bytes = ride();
  const t = Date.now();
  const [uploaded] = await Promise.all([
    uploadFit(runtime, token, bytes, { clock: deviceClock(t) }),
    push(token, "device-a", [ftpOn("2020-01-01", 250, deviceClock(t))]),
  ]);
  const activity = await uploaded.json();
  assert.equal((await row(activity.id)).ftp, 250);
});

test("a ride's own FTP is never replaced by the zone history", async () => {
  const { token, activity } = await riderWithRide({ ftp: 300 });
  await push(token, "device-a", [ftpOn("2020-01-01", 200, deviceClock(Date.now()))]);
  assert.equal((await row(activity.id)).ftp, 300);
});

test("correcting a ride's time zone moves its local start and the FTP of its day", async () => {
  const { token, activity } = await riderWithRide({ start: new Date("2026-02-28T23:30:00Z") });
  assert.equal(activity.startDateLocal, "2026-02-28T23:30:00");
  const t = Date.now();
  await push(token, "device-a", [ftpOn("2026-03-01", 250, deviceClock(t - 1000))]);
  assert.equal((await row(activity.id)).ftp, 250, "before the first entry, its FTP applies");
  await push(token, "device-a", [ftpOn("2026-02-01", 200, deviceClock(t - 500))]);
  assert.equal((await row(activity.id)).ftp, 200);
  await push(token, "device-a", [
    update(activity.id, { timezone: "Europe/Budapest" }, deviceClock(t)),
  ]);
  const stored = await row(activity.id);
  assert.equal(stored.timezone, "Europe/Budapest");
  assert.equal(stored.start_date_local, "2026-03-01T00:30:00");
  assert.equal(stored.ftp, 250);
  const [edit, derived] = (await eventsFor(activity.id)).slice(-2);
  assert.deepEqual(edit.updates, { fields: { timezone: "Europe/Budapest" } });
  assert.equal(derived.updates.derived.startDateLocal, "2026-03-01T00:30:00");
});
```

These tests send overlapping requests on purpose (`Promise.all`) where the old design raced: the
same change twice, an upload against a delete, an upload against a zone change. With one writer
per rider they settle the same way in every order, and the assertions check the final rows,
files and events rather than the order.

Run: `node --test tests/sync.test.mjs`
Expected: FAIL (`NOT_IMPLEMENTED` or 404).

- [ ] **Step 2: Implement applying changes**

Create `hosted/apps/api/src/sync/apply.ts`:

```ts
import type { ChangeResult, Derived, SyncChange } from "@trainstack/contract";
import { and, eq, isNull, sql } from "drizzle-orm";

import { derive, ftpChanges } from "../activities/ftp";
import { loadZoneEntries } from "../activities/training";
import { activity, type ActivityRow, settingsEntry } from "../db/schema";
import {
  commit,
  insertEvents,
  jsonChunks,
  markPending,
  type NewEvent,
  SERVER,
  see,
  serverClock,
  type Statement,
  type Writer,
} from "./writer";

type SettingsRow = typeof settingsEntry.$inferSelect;
type Status = ChangeResult["status"];
export type ActivityUpdate = Extract<SyncChange, { objectType: "activity"; op: "update" }>;
type ActivityDelete = Extract<SyncChange, { objectType: "activity"; op: "delete" }>;
type SettingsChange = Extract<SyncChange, { objectType: "settings" }>;

/** Each editable field and the column that holds its clock. */
const CLOCKS = {
  name: "nameClock",
  description: "descriptionClock",
  sportType: "sportTypeClock",
  hidden: "hiddenClock",
  timezone: "timezoneClock",
} as const;
type Field = keyof typeof CLOCKS;

/**
 * The rows a push touches, read once, changed in memory as each change is applied, and written
 * back in one transaction, so a push is applied whole or not at all.
 */
type Work = {
  activities: Map<string, ActivityRow>;
  /** By `<kind>:<entryId>`. */
  settings: Map<string, SettingsRow>;
  changedActivities: Set<string>;
  changedSettings: Set<string>;
  events: NewEvent[];
  /** Files of rides this push deleted. */
  deletedFiles: string[];
  /** Whether a zone change was applied, so every ride's FTP may have moved. */
  zones: boolean;
  /** Rides whose time zone changed, so their local day and FTP may have moved. */
  retimed: Set<string>;
};

const settingsKey = (kind: string, entryId: string) => `${kind}:${entryId}`;

/**
 * Applies a device's changes in order, each on its own: one that loses to a newer change does
 * not stop the rest. A change whose clock is already stored was applied before, so it counts as
 * applied and writes nothing, which makes sending again safe. Clocks are unique to a change, so
 * what a change with an equal clock carries is never compared.
 */
export async function applyChanges(
  writer: Writer,
  deviceId: string,
  changes: SyncChange[],
): Promise<ChangeResult[]> {
  const work = await load(writer, changes);
  const results = changes.map((change) => {
    see(writer, change.clock);
    let status: Status;
    if (change.objectType === "settings") status = changeSettings(writer, work, deviceId, change);
    else if (change.op === "update") status = updateActivity(work, deviceId, change);
    else status = deleteActivity(writer, work, deviceId, change);
    return { changeId: change.changeId, status };
  });
  await rederive(writer, work);
  await commit(writer, [
    ...saveActivities(
      writer,
      [...work.changedActivities].map((id) => work.activities.get(id)!),
    ),
    ...saveSettings(
      writer,
      [...work.changedSettings].map((key) => work.settings.get(key)!),
    ),
    ...insertEvents(writer, work.events),
    ...markPending(writer, work.deletedFiles),
  ]);
  return results;
}

async function load(writer: Writer, changes: SyncChange[]): Promise<Work> {
  const ids = changes.flatMap((change) =>
    change.objectType === "activity" ? [change.objectId] : [],
  );
  const keys = changes.flatMap((change) =>
    change.objectType === "settings" ? [settingsKey(change.kind, change.entryId)] : [],
  );
  const activities =
    ids.length === 0
      ? []
      : await writer.db
          .select()
          .from(activity)
          .where(
            and(
              eq(activity.userId, writer.userId),
              sql`${activity.id} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`,
            ),
          );
  const settings =
    keys.length === 0
      ? []
      : await writer.db
          .select()
          .from(settingsEntry)
          .where(
            and(
              eq(settingsEntry.userId, writer.userId),
              sql`${settingsEntry.kind} || ':' || ${settingsEntry.entryId}
                IN (SELECT value FROM json_each(${JSON.stringify(keys)}))`,
            ),
          );
  return {
    activities: new Map(activities.map((row) => [row.id, row])),
    settings: new Map(settings.map((row) => [settingsKey(row.kind, row.entryId), row])),
    changedActivities: new Set(),
    changedSettings: new Set(),
    events: [],
    deletedFiles: [],
    zones: false,
    retimed: new Set(),
  };
}

function updateActivity(work: Work, deviceId: string, change: ActivityUpdate): Status {
  const row = work.activities.get(change.objectId);
  if (!row) return "unknown_object";
  const fields = Object.keys(change.fields) as Field[];
  const winning = fields.filter((field) => row[CLOCKS[field]] < change.clock);
  if (winning.length === 0) {
    return fields.some((field) => row[CLOCKS[field]] === change.clock) ? "applied" : "superseded";
  }
  const won: Record<string, unknown> = {};
  for (const field of winning) {
    won[field] = change.fields[field];
    Object.assign(row, { [field]: change.fields[field], [CLOCKS[field]]: change.clock });
  }
  work.changedActivities.add(row.id);
  if (winning.includes("timezone")) work.retimed.add(row.id);
  work.events.push({
    objectType: "activity",
    objectId: row.id,
    aspectType: "update",
    updates: { fields: won },
    clock: change.clock,
    deviceId,
  });
  return "applied";
}

function deleteActivity(
  writer: Writer,
  work: Work,
  deviceId: string,
  change: Pick<ActivityDelete, "objectId" | "clock">,
): Status {
  const row = work.activities.get(change.objectId);
  if (!row) return "unknown_object";
  if (change.clock === row.existenceClock) return "applied";
  if (change.clock < row.existenceClock) return "superseded";
  row.deletedAt ??= writer.now;
  row.existenceClock = change.clock;
  work.changedActivities.add(row.id);
  // The rider asked for the ride to go, so its file goes too, by the sweep after this commits.
  work.deletedFiles.push(row.fitSha256);
  work.events.push({
    objectType: "activity",
    objectId: row.id,
    aspectType: "delete",
    updates: null,
    clock: change.clock,
    deviceId,
  });
  return "applied";
}

function changeSettings(
  writer: Writer,
  work: Work,
  deviceId: string,
  change: SettingsChange,
): Status {
  const key = settingsKey(change.kind, change.entryId);
  const current = work.settings.get(key);
  if (current?.clock === change.clock) return "applied";
  if (current && current.clock > change.clock) return "superseded";
  const deleting = change.op === "delete";
  // A delete of an entry the server never saw still leaves a tombstone, so the entry cannot
  // arrive later from a device that is behind.
  work.settings.set(key, {
    userId: writer.userId,
    kind: change.kind,
    entryId: change.entryId,
    value: deleting ? null : change.value,
    clock: change.clock,
    deletedAt: deleting ? writer.now : null,
  });
  work.changedSettings.add(key);
  if (change.kind === "zone_change") work.zones = true;
  work.events.push({
    objectType: "settings",
    objectId: key,
    aspectType: deleting ? "delete" : current ? "update" : "create",
    updates: deleting ? null : { value: change.value },
    clock: change.clock,
    deviceId,
  });
  return "applied";
}

const sameDerived = (row: ActivityRow, derived: Derived) =>
  row.startDateLocal === derived.startDateLocal &&
  row.ftp === derived.ftp &&
  row.intensityFactor === derived.intensityFactor &&
  row.trainingStress === derived.trainingStress;

/**
 * Works out the derived values again where this push may have moved them: every ride without
 * its own FTP after a zone change, and any ride whose time zone changed. Each ride whose values
 * moved gets an `update` event carrying them, so devices never keep IF and TSS the server has
 * replaced.
 */
async function rederive(writer: Writer, work: Work) {
  if (!work.zones && work.retimed.size === 0) return;
  const zones = new Map((await loadZoneEntries(writer)).map((entry) => [entry.day, entry.value]));
  for (const entry of work.settings.values()) {
    if (entry.kind !== "zone_change") continue;
    if (entry.deletedAt === null) zones.set(entry.entryId, entry.value);
    else zones.delete(entry.entryId);
  }
  const timeline = ftpChanges([...zones].map(([day, value]) => ({ day, value })));
  if (work.zones) {
    const rows = await writer.db
      .select()
      .from(activity)
      .where(and(eq(activity.userId, writer.userId), isNull(activity.fitFtp)));
    for (const row of rows) if (!work.activities.has(row.id)) work.activities.set(row.id, row);
  }
  let clock: string | undefined;
  for (const row of work.activities.values()) {
    if (!work.retimed.has(row.id) && !(work.zones && row.fitFtp === null)) continue;
    const derived = derive(row, timeline);
    if (sameDerived(row, derived)) continue;
    Object.assign(row, derived);
    work.changedActivities.add(row.id);
    work.events.push({
      objectType: "activity",
      objectId: row.id,
      aspectType: "update",
      updates: { derived },
      clock: (clock ??= serverClock(writer)),
      deviceId: SERVER,
    });
  }
}

/** Writes back every editable field, clock and derived value of `rows`. */
const saveActivities = (writer: Writer, rows: ActivityRow[]): Statement[] =>
  jsonChunks(rows).map((items) =>
    writer.db.run(sql`
      UPDATE activity SET
        name = j.value ->> '$.name', name_clock = j.value ->> '$.nameClock',
        description = j.value ->> '$.description',
        description_clock = j.value ->> '$.descriptionClock',
        sport_type = j.value ->> '$.sportType', sport_type_clock = j.value ->> '$.sportTypeClock',
        hidden = j.value ->> '$.hidden', hidden_clock = j.value ->> '$.hiddenClock',
        timezone = j.value ->> '$.timezone', timezone_clock = j.value ->> '$.timezoneClock',
        start_date_local = j.value ->> '$.startDateLocal', ftp = j.value ->> '$.ftp',
        intensity_factor = j.value ->> '$.intensityFactor',
        training_stress = j.value ->> '$.trainingStress',
        deleted_at = j.value ->> '$.deletedAt', existence_clock = j.value ->> '$.existenceClock',
        updated_at = ${writer.now}
      FROM json_each(${items}) AS j
      WHERE activity.id = j.value ->> '$.id' AND activity.user_id = ${writer.userId}
    `),
  );

const saveSettings = (writer: Writer, entries: SettingsRow[]): Statement[] =>
  jsonChunks(entries).map((items) =>
    writer.db.run(sql`
      INSERT INTO settings_entry (user_id, kind, entry_id, value, clock, deleted_at)
      SELECT ${writer.userId}, j.value ->> '$.kind', j.value ->> '$.entryId',
        nullif(j.value -> '$.value', 'null'), j.value ->> '$.clock', j.value ->> '$.deletedAt'
      FROM json_each(${items}) AS j WHERE true
      ON CONFLICT (user_id, kind, entry_id) DO UPDATE SET
        value = excluded.value, clock = excluded.clock, deleted_at = excluded.deleted_at
    `),
  );
```

- [ ] **Step 3: Run pushes in the writer**

Change `hosted/apps/api/src/athletes/writer.ts`:

```diff
--- a/hosted/apps/api/src/athletes/writer.ts
+++ b/hosted/apps/api/src/athletes/writer.ts
@@ -1,7 +1,9 @@
+import type { ChangeResult, SyncChange } from "@trainstack/contract";
 import { DurableObject } from "cloudflare:workers";

 import { storeUpload, type UploadInput, type UploadResult } from "../activities/store";
 import { getBlobs, getDb } from "../services";
+import { applyChanges } from "../sync/apply";
 import { openWriter, sweep, type Writer } from "../sync/writer";

 /** How long after an operation its sweep runs again, in case the operation never finished. */
@@ -50,6 +52,10 @@ export class AthleteWriter extends DurableObject {
     return this.#run(userId, (writer) => storeUpload(writer, input));
   }

+  applyChanges(userId: string, deviceId: string, changes: SyncChange[]): Promise<ChangeResult[]> {
+    return this.#run(userId, (writer) => applyChanges(writer, deviceId, changes));
+  }
+
   async alarm() {
     await this.#serialize(async () => {
       const userId = await this.ctx.storage.get<string>("userId");
```

- [ ] **Step 4: Cap JSON bodies and serve the contract at `/v1`**

Change `hosted/apps/api/src/http.ts`:

```diff
--- a/hosted/apps/api/src/http.ts
+++ b/hosted/apps/api/src/http.ts
@@ -1,4 +1,6 @@
 export const MAX_FIT_BYTES = 10 * 1024 * 1024;
+/** The largest JSON body the oRPC handlers read: room for a full push, and no more parsing. */
+export const MAX_JSON_BYTES = 1024 * 1024;

 /** The request's body, or nothing if it is longer than `limit`, without reading past the limit. */
 export async function readBody(request: Request, limit: number): Promise<Uint8Array | undefined> {
@@ -24,3 +26,15 @@ export async function readBody(request: Request, limit: number): Promise<Uint8Ar
   }
   return body;
 }
+
+/**
+ * `request` with its body read into memory, or nothing if the body is longer than `limit`, so a
+ * handler that parses it never sees more than that.
+ */
+export async function boundedRequest(request: Request, limit: number) {
+  if (request.method === "GET" || request.method === "HEAD") return request;
+  if (Number(request.headers.get("content-length") ?? 0) > limit) return undefined;
+  const body = await readBody(request, limit);
+  if (!body) return undefined;
+  return new Request(request.url, { method: request.method, headers: request.headers, body });
+}
```

Change `hosted/apps/api/src/index.ts`:

```diff
--- a/hosted/apps/api/src/index.ts
+++ b/hosted/apps/api/src/index.ts
@@ -13,6 +13,7 @@ import { cors } from "hono/cors";
 import { activityRoutes } from "./activities/routes";
 import { createContext } from "./context";
 import { ENV } from "./env.server";
+import { boundedRequest, MAX_JSON_BYTES } from "./http";
 import { appRouter } from "./router";
 import { createAuth, getBlobs, getDb, writerOf } from "./services";
 import { stravaRoutes } from "./strava";
@@ -96,6 +97,15 @@ export const apiHandler = new OpenAPIHandler(appRouter, {
   ],
 });

+/** The TrainStack API the apps use: REST paths from the contract, under `/v1`. */
+export const v1Handler = new OpenAPIHandler(appRouter, {
+  interceptors: [
+    onError((error) => {
+      console.error(error);
+    }),
+  ],
+});
+
 export const rpcHandler = new RPCHandler(appRouter, {
   interceptors: [
     onError((error) => {
@@ -105,9 +115,21 @@ export const rpcHandler = new RPCHandler(appRouter, {
 });

 app.use("/*", async (c, next) => {
+  const request = await boundedRequest(c.req.raw, MAX_JSON_BYTES);
+  if (!request) {
+    return c.json(
+      { code: "PAYLOAD_TOO_LARGE", status: 413, message: "The body is too large." },
+      413,
+    );
+  }
   const context = await createContext({ context: c });

-  const rpcResult = await rpcHandler.handle(c.req.raw, {
+  const v1Result = await v1Handler.handle(request, { prefix: "/v1", context });
+  if (v1Result.matched) {
+    return c.newResponse(v1Result.response.body, v1Result.response);
+  }
+
+  const rpcResult = await rpcHandler.handle(request, {
     prefix: "/rpc",
     context: context,
   });
@@ -116,7 +138,7 @@ app.use("/*", async (c, next) => {
     return c.newResponse(rpcResult.response.body, rpcResult.response);
   }

-  const apiResult = await apiHandler.handle(c.req.raw, {
+  const apiResult = await apiHandler.handle(request, {
     prefix: "/api-reference",
     context: context,
   });
```

The cap applies to every oRPC handler, `/rpc` and `/api-reference` included, since they serve the
same procedures.

- [ ] **Step 5: Implement `sync.push`**

Replace `hosted/apps/api/src/router.ts` with:

```ts
import { implement, ORPCError } from "@orpc/server";
import {
  appContract,
  type ChangeProblem,
  type SyncChange,
  syncChangeSchema,
} from "@trainstack/contract";
import { z } from "zod";

import { CALLS_PER_WINDOW } from "./activities/routes";
import { createBudget } from "./budget";
import type { Context } from "./context";
import { getDb, writerOf } from "./services";
import { clockProblem } from "./sync/clock";

const api = implement(appContract).$context<Context>();
const { spend } = createBudget(getDb);

const requireAuth = api.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context: { session: context.session } });
});

/** A signed-in rider within their share of the API: 300 calls every 15 minutes. */
const rider = api.middleware(async ({ context, next }) => {
  if (!context.session?.user) throw new ORPCError("UNAUTHORIZED");
  if (!(await spend(`api:${context.session.user.id}`, CALLS_PER_WINDOW))) {
    throw new ORPCError("RATE_LIMITED", { status: 429 });
  }
  return next({ context: { session: context.session } });
});

/** Answers procedures this branch has not built yet; the last of them goes in Task 9. */
const notYet = () => {
  throw new ORPCError("NOT_IMPLEMENTED");
};

/**
 * The push's changes, each checked on its own so that every malformed one is reported by index
 * in the same shape, or the problems.
 */
function checkChanges(raw: unknown[], now: number) {
  const changes: SyncChange[] = [];
  const problems: ChangeProblem[] = [];
  raw.forEach((candidate, index) => {
    const parsed = syncChangeSchema.safeParse(candidate);
    if (!parsed.success) {
      problems.push({ index, reason: "invalid_change", message: z.prettifyError(parsed.error) });
    } else if (clockProblem(parsed.data.clock, now) === "ahead") {
      problems.push({ index, reason: "clock_ahead", message: "The clock is too far ahead." });
    } else {
      changes.push(parsed.data);
    }
  });
  return { changes, problems };
}

export const appRouter = api.router({
  healthCheck: api.healthCheck.handler(() => "OK"),
  privateData: api.privateData.use(requireAuth).handler(({ context }) => ({
    message: "This is private",
    user: context.session.user,
  })),
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
    push: api.sync.push.use(rider).handler(async ({ context, input, errors }) => {
      const { changes, problems } = checkChanges(input.changes, Date.now());
      if (problems.length > 0) throw errors.INVALID_CHANGES({ data: { problems } });
      const userId = context.session.user.id;
      const results = await writerOf(userId).applyChanges(userId, input.deviceId, changes);
      return { results, serverTime: Date.now() };
    }),
    events: api.sync.events.handler(notYet),
    manifest: api.sync.manifest.handler(notYet),
  },
});
```

`rider` checks the session and spends from the rider's API budget in one middleware, so handlers
read `context.session` with its type narrowed.

- [ ] **Step 6: Run the tests**

Run: `bun run format && node --test tests/sync.test.mjs tests/activities.test.mjs tests/worker.test.mjs && bun run check-types`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add hosted/apps/api/src/sync/apply.ts hosted/apps/api/src/athletes/writer.ts \
  hosted/apps/api/src/http.ts hosted/apps/api/src/index.ts hosted/apps/api/src/router.ts \
  tests/sync.test.mjs
git commit -m "api: apply synced ride and settings changes with per-field last-write-wins"
```

---

### Task 8: Pulling events, pruning and the manifest

**Files:**

- Create: `hosted/apps/api/src/sync/events.ts`
- Modify: `hosted/apps/api/src/athletes/writer.ts` (prune before each operation)
- Modify: `hosted/apps/api/src/router.ts`
- Test: `tests/sync.test.mjs` (append)

**Interfaces:**

- Consumes: `Writer` (Task 6), `toManifestActivity` (Task 6), `SyncEvent`, `SettingsEntry`,
  `ManifestActivity` (Task 4).
- Produces: `EVENT_RETENTION_MS`, `MAX_PAGE_BYTES`, `class CursorExpired extends Error`,
  `class InvalidPage extends Error`, `prune(writer: Writer): Promise<void>`,
  `pullEvents(db: Database, userId: string, after: number, limit: number): Promise<{ events: SyncEvent[]; next: number; hasMore: boolean }>`,
  `manifestPage(db: Database, userId: string, page: string | undefined, limit: number): Promise<{ cursor: number; activities: ManifestActivity[]; settings: SettingsEntry[]; next: string | null }>`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/sync.test.mjs`:

```js
const pull = async (token, after = 0, limit) => {
  const query = new URLSearchParams({
    after: String(after),
    ...(limit ? { limit: String(limit) } : {}),
  });
  const response = await v1(runtime, token, `/sync/events?${query}`);
  return { status: response.status, body: await response.json() };
};

/** Every event after `after`, page by page. */
async function pullAll(token, after = 0) {
  const events = [];
  for (;;) {
    const page = await pull(token, after, 2);
    assert.equal(page.status, 200);
    events.push(...page.body.events);
    after = page.body.next;
    if (!page.body.hasMore) return { events, cursor: after };
  }
}

/** The whole manifest, page by page. */
async function manifestOf(token, limit = 1) {
  const pages = [];
  let page;
  do {
    const query = new URLSearchParams({ limit: String(limit), ...(page ? { page } : {}) });
    const response = await v1(runtime, token, `/sync/manifest?${query}`);
    assert.equal(response.status, 200);
    pages.push(await response.json());
    page = pages.at(-1).next;
  } while (page);
  assert.ok(
    pages.every((p) => p.cursor === pages[0].cursor),
    "one cursor for every page",
  );
  return {
    cursor: pages[0].cursor,
    activities: pages.flatMap((p) => p.activities),
    settings: pages.flatMap((p) => p.settings),
  };
}

const FIELDS = ["name", "description", "sportType", "hidden", "timezone"];
const DERIVED = ["startDateLocal", "ftp", "intensityFactor", "trainingStress"];

/**
 * What a device holds after applying `events` to `state` the way the spec says: fields and
 * existence by last-write-wins on their clocks, derived values as the latest event gives them,
 * settings entries whole by clock.
 */
function replay(events, state = { activities: new Map(), settings: new Map() }) {
  for (const event of events) {
    if (event.objectType === "settings") {
      const current = state.settings.get(event.objectId);
      if (current && current.clock >= event.clock) continue;
      const deleted = event.aspectType === "delete";
      state.settings.set(event.objectId, {
        value: deleted ? null : event.updates.value,
        clock: event.clock,
        deleted,
      });
      continue;
    }
    const current = state.activities.get(event.objectId);
    if (event.aspectType === "create" && !current) {
      state.activities.set(event.objectId, structuredClone(event.updates));
      continue;
    }
    if (event.aspectType === "create") {
      for (const field of FIELDS) {
        if (event.updates.clocks[field] > current.clocks[field]) {
          current[field] = event.updates[field];
          current.clocks[field] = event.updates.clocks[field];
        }
      }
      for (const field of DERIVED) current[field] = event.updates[field];
    }
    if (event.aspectType === "create" || event.aspectType === "delete") {
      if (event.clock > current.clocks.existence) {
        current.deleted = event.aspectType === "delete";
        current.clocks.existence = event.clock;
      }
      continue;
    }
    for (const [field, value] of Object.entries(event.updates.fields ?? {})) {
      if (event.clock > current.clocks[field]) {
        current[field] = value;
        current.clocks[field] = event.clock;
      }
    }
    Object.assign(current, event.updates.derived ?? {});
  }
  return state;
}

/** A manifest as the state a device would build from it. */
const stateOf = (manifest) => ({
  activities: new Map(manifest.activities.map((a) => [a.id, structuredClone(a)])),
  settings: new Map(
    manifest.settings.map((s) => [
      `${s.kind}:${s.entryId}`,
      { value: s.value, clock: s.clock, deleted: s.deleted },
    ]),
  ),
});

const comparable = (state) => ({
  activities: Object.fromEntries(
    [...state.activities].map(([id, a]) => [
      id,
      Object.fromEntries([...FIELDS, ...DERIVED, "deleted", "clocks"].map((k) => [k, a[k]])),
    ]),
  ),
  settings: Object.fromEntries(state.settings),
});

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
  assert.deepEqual(
    first.body.events.map((e) => e.aspectType),
    ["create", "update"],
  );
  assert.equal(first.body.hasMore, true);
  assert.equal(first.body.events[0].updates.fitSha256, activity.fitSha256);
  const rest = await pull(token, first.body.next);
  assert.deepEqual(
    rest.body.events.map((e) => e.updates.fields.name),
    ["Two", "Three"],
  );
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
  const { token, userId, activity } = await riderWithRide();
  const t = Date.now();
  await push(token, "device-a", [update(activity.id, { name: "Old news" }, deviceClock(t))]);
  await db
    .prepare("UPDATE sync_event SET created_at = created_at - ? WHERE user_id = ?")
    .bind(181 * 86_400_000, userId)
    .run();
  // The rider's writer prunes on its next operation.
  await push(token, "device-a", [setting("preference", "units", "metric", deviceClock(t + 1))]);
  const expired = await pull(token, 0);
  assert.equal(expired.status, 410);
  assert.equal(expired.body.code, "CURSOR_EXPIRED");

  const manifest = await manifestOf(token);
  const listed = manifest.activities.find((a) => a.id === activity.id);
  assert.equal(listed.name, "Old news");
  assert.equal(listed.clocks.name, deviceClock(t));
  assert.equal(listed.deleted, false);
  const resumed = await pull(token, manifest.cursor);
  assert.equal(resumed.status, 200);
  assert.deepEqual(resumed.body.events, []);
});

test("the manifest lists deleted rides and settings tombstones, a page at a time", async () => {
  const { token, activity } = await riderWithRide();
  const t = Date.now();
  await uploadFit(runtime, token, ride(), { clock: deviceClock(t - 5000) });
  await push(token, "device-a", [
    remove(activity.id, deviceClock(t)),
    setting("ftp_test", "test-1", undefined, deviceClock(t)),
    setting("preference", "units", "metric", deviceClock(t)),
  ]);
  const manifest = await manifestOf(token, 1);
  assert.equal(manifest.activities.length, 2);
  assert.equal(manifest.activities.find((a) => a.id === activity.id).deleted, true);
  const tombstone = manifest.settings.find((s) => s.entryId === "test-1");
  assert.equal(tombstone.deleted, true);
  assert.equal(tombstone.value, null);
  assert.equal(manifest.settings.find((s) => s.entryId === "units").value, "metric");
  const bad = await v1(runtime, token, "/sync/manifest?page=nonsense");
  assert.equal(bad.status, 400);
});

test("replaying the events gives what the manifest says, before and after it", async () => {
  const { token, activity } = await riderWithRide();
  const bytes = ride();
  const t = Date.now();
  const second = await (
    await uploadFit(runtime, token, bytes, { clock: deviceClock(t - 9000) })
  ).json();
  await push(token, "device-a", [
    update(activity.id, { name: "Renamed" }, deviceClock(t - 8000)),
    ftpOn("2020-01-01", 250, deviceClock(t - 7000)),
    remove(second.id, deviceClock(t - 6000)),
  ]);
  await push(token, "device-b", [
    update(
      second.id,
      { description: "Edited while deleted" },
      deviceClock(t - 5000, 0, "device-b"),
    ),
    update(activity.id, { name: "Older" }, deviceClock(t - 8500, 0, "device-b")),
  ]);
  const middle = await manifestOf(token);
  await uploadFit(runtime, token, bytes, { clock: deviceClock(t - 4000) });
  await push(token, "device-a", [
    update(activity.id, { timezone: "America/Los_Angeles" }, deviceClock(t - 3000)),
    setting("zone_change", "2020-01-01", undefined, deviceClock(t - 2000)),
    setting("preference", "units", "metric", deviceClock(t - 1000)),
  ]);
  const final = await manifestOf(token);

  const fromStart = replay((await pullAll(token, 0)).events);
  assert.deepEqual(comparable(fromStart), comparable(stateOf(final)));
  const fromMiddle = replay((await pullAll(token, middle.cursor)).events, stateOf(middle));
  assert.deepEqual(comparable(fromMiddle), comparable(stateOf(final)));
  const restored = final.activities.find((a) => a.id === second.id);
  assert.equal(restored.deleted, false);
  assert.equal(restored.description, "Edited while deleted");
  assert.equal(restored.trainingStress, null, "the zone change is gone again");
});
```

`replay` is the device's side of the protocol as the spec states it, written once here so the
test checks the rule rather than the server's own code.

Run: `node --test tests/sync.test.mjs`
Expected: the new tests FAIL.

- [ ] **Step 2: Implement events, pruning and the manifest**

Create `hosted/apps/api/src/sync/events.ts`:

```ts
import type { ManifestActivity, SettingsEntry, SyncEvent } from "@trainstack/contract";
import { and, asc, eq, gt, max, sql } from "drizzle-orm";

import { toManifestActivity } from "../activities/shape";
import type { Database } from "../db";
import { activity, settingsEntry, syncEvent, syncState } from "../db/schema";
import type { Writer } from "./writer";

/** How long events are kept. Devices further behind start over from the manifest. */
export const EVENT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
/** A page stops once its items pass this much JSON, but always holds at least one item. */
export const MAX_PAGE_BYTES = 1024 * 1024;

/** The device's cursor points at events that have been pruned. */
export class CursorExpired extends Error {}

/** A manifest page token this server did not make. */
export class InvalidPage extends Error {}

/** The first of `items` that fit in a page. */
function fitPage<T>(items: T[]): T[] {
  const page: T[] = [];
  let bytes = 0;
  for (const item of items) {
    bytes += new TextEncoder().encode(JSON.stringify(item)).byteLength;
    if (page.length > 0 && bytes > MAX_PAGE_BYTES) break;
    page.push(item);
  }
  return page;
}

/**
 * Drops the rider's events older than the retention and remembers the newest one dropped, in one
 * batch, so a cursor is never quietly behind a gap. Run by the rider's writer.
 */
export async function prune(writer: Writer) {
  const cutoff = writer.now - EVENT_RETENTION_MS;
  await writer.db.batch([
    writer.db.run(sql`
      INSERT INTO sync_state (user_id, pruned_through, clock)
      SELECT ${writer.userId}, seq, ${writer.clock} FROM (
        SELECT max(seq) AS seq FROM sync_event
        WHERE user_id = ${writer.userId} AND created_at < ${cutoff}
      ) WHERE seq IS NOT NULL
      ON CONFLICT (user_id) DO UPDATE SET
        pruned_through = max(pruned_through, excluded.pruned_through)
    `),
    writer.db.run(
      sql`DELETE FROM sync_event WHERE user_id = ${writer.userId} AND created_at < ${cutoff}`,
    ),
  ]);
}

/**
 * The rider's events after `after`. How far the log is pruned and the page are read in one
 * batch, which D1 runs as one transaction, so pruning cannot slip between the check and the read.
 */
export async function pullEvents(db: Database, userId: string, after: number, limit: number) {
  const [state, rows] = await db.batch([
    db
      .select({ prunedThrough: syncState.prunedThrough })
      .from(syncState)
      .where(eq(syncState.userId, userId)),
    db
      .select()
      .from(syncEvent)
      .where(and(eq(syncEvent.userId, userId), gt(syncEvent.seq, after)))
      .orderBy(asc(syncEvent.seq))
      .limit(limit + 1),
  ]);
  if (after < (state[0]?.prunedThrough ?? 0)) throw new CursorExpired();
  const events = fitPage(
    rows.slice(0, limit).map((row): SyncEvent => ({
      seq: row.seq,
      objectType: row.objectType,
      objectId: row.objectId,
      aspectType: row.aspectType,
      updates: row.updates as Record<string, unknown> | null,
      clock: row.clock,
      deviceId: row.deviceId,
      eventTime: row.createdAt,
    })),
  );
  return {
    events,
    next: events.at(-1)?.seq ?? after,
    hasMore: events.length < rows.length,
  };
}

/** Where a manifest page starts: the event cursor, which list, and the last key before it. */
type Position = { cursor: number; kind: "activity" | "settings"; after: string };

const encodePage = ({ cursor, kind, after }: Position) => `${cursor}.${kind}.${after}`;

function decodePage(page: string): Position {
  const match = /^(\d+)\.(activity|settings)\.(.*)$/.exec(page);
  if (!match) throw new InvalidPage();
  return { cursor: Number(match[1]), kind: match[2] as Position["kind"], after: match[3]! };
}

const settingsKey = sql<string>`${settingsEntry.kind} || ':' || ${settingsEntry.entryId}`;

/**
 * One page of everything a device needs to start over: activities by ID, then settings. The
 * cursor is read before the first page and carried through the rest, so anything that changes
 * while the device pages is in the events after it; seeing a change twice is harmless, since
 * registers merge by clock and derived values by event order.
 */
export async function manifestPage(
  db: Database,
  userId: string,
  page: string | undefined,
  limit: number,
) {
  let position: Position;
  if (page === undefined) {
    const [top, state] = await db.batch([
      db
        .select({ seq: max(syncEvent.seq) })
        .from(syncEvent)
        .where(eq(syncEvent.userId, userId)),
      db
        .select({ prunedThrough: syncState.prunedThrough })
        .from(syncState)
        .where(eq(syncState.userId, userId)),
    ]);
    const cursor = Math.max(top[0]?.seq ?? 0, state[0]?.prunedThrough ?? 0);
    position = { cursor, kind: "activity", after: "" };
  } else {
    position = decodePage(page);
  }

  let activities: ManifestActivity[] = [];
  let settings: SettingsEntry[] = [];
  let next: string | null;
  if (position.kind === "activity") {
    const rows = await db
      .select()
      .from(activity)
      .where(and(eq(activity.userId, userId), gt(activity.id, position.after)))
      .orderBy(asc(activity.id))
      .limit(limit + 1);
    activities = fitPage(rows.slice(0, limit).map(toManifestActivity));
    next =
      activities.length < rows.length
        ? encodePage({ ...position, after: activities.at(-1)!.id })
        : encodePage({ cursor: position.cursor, kind: "settings", after: "" });
  } else {
    const rows = await db
      .select()
      .from(settingsEntry)
      .where(and(eq(settingsEntry.userId, userId), gt(settingsKey, position.after)))
      .orderBy(asc(settingsKey))
      .limit(limit + 1);
    settings = fitPage(
      rows.slice(0, limit).map((entry) => ({
        kind: entry.kind,
        entryId: entry.entryId,
        value: entry.value,
        clock: entry.clock,
        deleted: entry.deletedAt !== null,
      })),
    );
    const last = settings.at(-1);
    next =
      settings.length < rows.length && last
        ? encodePage({ ...position, after: `${last.kind}:${last.entryId}` })
        : null;
  }
  return { cursor: position.cursor, activities, settings, next };
}
```

- [ ] **Step 3: Prune in the writer**

Change `hosted/apps/api/src/athletes/writer.ts`:

```diff
--- a/hosted/apps/api/src/athletes/writer.ts
+++ b/hosted/apps/api/src/athletes/writer.ts
@@ -4,6 +4,7 @@ import { DurableObject } from "cloudflare:workers";
 import { storeUpload, type UploadInput, type UploadResult } from "../activities/store";
 import { getBlobs, getDb } from "../services";
 import { applyChanges } from "../sync/apply";
+import { prune } from "../sync/events";
 import { openWriter, sweep, type Writer } from "../sync/writer";

 /** How long after an operation its sweep runs again, in case the operation never finished. */
@@ -40,6 +41,7 @@ export class AthleteWriter extends DurableObject {
         await this.ctx.storage.setAlarm(Date.now() + SWEEP_DELAY_MS);
       }
       const writer = await openWriter(getDb(), getBlobs(), userId, Date.now());
+      await prune(writer);
       try {
         return await task(writer);
       } finally {
```

Pruning at the start of every operation is two indexed statements; doing it in the writer keeps
it serialized with the rider's other writes.

- [ ] **Step 4: Wire the handlers**

Change `hosted/apps/api/src/router.ts`:

```diff
--- a/hosted/apps/api/src/router.ts
+++ b/hosted/apps/api/src/router.ts
@@ -12,6 +12,7 @@ import { createBudget } from "./budget";
 import type { Context } from "./context";
 import { getDb, writerOf } from "./services";
 import { clockProblem } from "./sync/clock";
+import { CursorExpired, InvalidPage, manifestPage, pullEvents } from "./sync/events";

 const api = implement(appContract).$context<Context>();
 const { spend } = createBudget(getDb);
@@ -81,7 +82,23 @@ export const appRouter = api.router({
       const results = await writerOf(userId).applyChanges(userId, input.deviceId, changes);
       return { results, serverTime: Date.now() };
     }),
-    events: api.sync.events.handler(notYet),
-    manifest: api.sync.manifest.handler(notYet),
+    events: api.sync.events.use(rider).handler(async ({ context, input, errors }) => {
+      try {
+        const page = await pullEvents(getDb(), context.session.user.id, input.after, input.limit);
+        return { ...page, serverTime: Date.now() };
+      } catch (error) {
+        if (error instanceof CursorExpired) throw errors.CURSOR_EXPIRED();
+        throw error;
+      }
+    }),
+    manifest: api.sync.manifest.use(rider).handler(async ({ context, input, errors }) => {
+      try {
+        const page = await manifestPage(getDb(), context.session.user.id, input.page, input.limit);
+        return { ...page, serverTime: Date.now() };
+      } catch (error) {
+        if (error instanceof InvalidPage) throw errors.INVALID_PAGE();
+        throw error;
+      }
+    }),
   },
 });
```

- [ ] **Step 5: Run the tests**

Run: `bun run format && node --test tests/sync.test.mjs && bun run check-types`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add hosted/apps/api/src/sync/events.ts hosted/apps/api/src/athletes/writer.ts \
  hosted/apps/api/src/router.ts tests/sync.test.mjs
git commit -m "api: let devices pull sync events and recover from a manifest"
```

---

### Task 9: Activities and athlete API

**Files:**

- Modify: `hosted/apps/api/src/sync/apply.ts` (server edits)
- Modify: `hosted/apps/api/src/athletes/writer.ts`
- Create: `hosted/apps/api/src/activities/queries.ts`
- Modify: `hosted/apps/api/src/router.ts`
- Test: `tests/activities.test.mjs` (append)

**Interfaces:**

- Consumes: `applyChanges`, `ActivityUpdate` (Task 7), `serverClock`, `SERVER`, `toSummary`,
  `localTimestamp`, `fitKey`, `getBlobs`, `writerOf` (Task 6), `parseLaps` (Task 3).
- Produces:
  - `type ServerEdit = { objectId: string; op: "update"; fields: ActivityUpdate["fields"] } | { objectId: string; op: "delete" }`,
    `applyServerEdit(writer: Writer, edit: ServerEdit): Promise<ChangeResult["status"] | "not_found">`
  - `AthleteWriter.edit(userId: string, edit: ServerEdit)`
  - `findLiveActivity(db: Database, userId: string, id: string): Promise<ActivityRow | undefined>`,
    `listActivities(db: Database, userId: string, query: { before?: number; after?: number; cursor?: string; limit: number }): Promise<{ activities: SummaryActivity[]; next: string | null }>`,
    `athleteStats(db: Database, userId: string, timezone: string | null, at: number): Promise<AthleteStats>`

- [ ] **Step 1: Write the failing tests**

Append to `tests/activities.test.mjs`:

```js
test("the activity list pages newest first and skips deleted rides", async () => {
  const { token } = await signUp(runtime);
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await (await uploadFit(runtime, token, ride())).json()).id);
  const deleted = await v1(runtime, token, `/activities/${ids[1]}`, { method: "DELETE" });
  assert.equal(deleted.status, 204);
  const first = await (await v1(runtime, token, "/athlete/activities?limit=1")).json();
  assert.deepEqual(
    first.activities.map((a) => a.id),
    [ids[2]],
  );
  const second = await (
    await v1(runtime, token, `/athlete/activities?limit=1&cursor=${encodeURIComponent(first.next)}`)
  ).json();
  assert.deepEqual(
    second.activities.map((a) => a.id),
    [ids[0]],
  );
  assert.equal(second.next, null);
});

test("an activity's detail has its laps and description, and API edits are events", async () => {
  const { token } = await signUp(runtime);
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
  const last = (await eventsFor(created.id)).at(-1);
  assert.equal(last.device_id, "server");
  assert.equal(last.aspect_type, "update");
});

test("API edits win over device clocks that run ahead, and over each other in order", async () => {
  const { token } = await signUp(runtime);
  const created = await (await uploadFit(runtime, token, ride())).json();
  const ahead = deviceClock(Date.now() + 5 * 60_000);
  const pushed = await v1(runtime, token, "/sync/changes", {
    method: "POST",
    json: {
      deviceId: "device-a",
      changes: [
        {
          changeId: "c",
          objectType: "activity",
          objectId: created.id,
          op: "update",
          fields: { name: "Device" },
          clock: ahead,
        },
      ],
    },
  });
  assert.equal(pushed.status, 200);
  for (const name of ["First", "Second"]) {
    const response = await v1(runtime, token, `/activities/${created.id}`, {
      method: "PUT",
      json: { fields: { name } },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).name, name);
  }
  const clocks = (await eventsFor(created.id))
    .filter((e) => e.device_id === "server")
    .map((e) => e.clock);
  assert.equal(clocks.length, 2);
  assert.ok(
    clocks[0] > ahead && clocks[1] > clocks[0],
    "each server clock is later than all before it",
  );
  const removed = await v1(runtime, token, `/activities/${created.id}`, { method: "DELETE" });
  assert.equal(removed.status, 204);
  const row = await db
    .prepare("SELECT deleted_at FROM activity WHERE id = ?")
    .bind(created.id)
    .first();
  assert.ok(row.deleted_at);
  assert.equal(
    (await v1(runtime, token, `/activities/${created.id}`, { method: "DELETE" })).status,
    404,
  );
});

test("another rider's activity is not found", async () => {
  const owner = await signUp(runtime);
  const other = await signUp(runtime);
  const created = await (await uploadFit(runtime, owner.token, ride())).json();
  for (const init of [
    {},
    { method: "PUT", json: { fields: { name: "x" } } },
    { method: "DELETE" },
  ]) {
    const response = await v1(runtime, other.token, `/activities/${created.id}`, init);
    assert.equal(response.status, 404, JSON.stringify(init));
  }
});

test("stats count rides by local day, as of the moment asked for", async () => {
  const { token } = await signUp(runtime);
  const at = Date.parse("2027-01-05T12:00:00Z");
  const upload = async (start, timezone, options = {}) =>
    (
      await uploadFit(
        runtime,
        token,
        ride({ start: new Date(start), ...options }),
        timezone ? { timezone } : {},
      )
    ).json();
  // 03:00 UTC on New Year's Day is 04:00 in Budapest but still 2026 in Los Angeles.
  await upload("2027-01-01T03:00:00Z", "Europe/Budapest");
  await upload("2027-01-01T03:01:00Z", "America/Los_Angeles");
  await upload("2026-12-08T12:00:00Z"); // 28 days before the 5th: just outside the four weeks
  await upload("2026-12-09T00:30:00Z"); // 27 days before: just inside
  await upload("2027-01-06T08:00:00Z"); // after the moment asked for
  await upload("2027-01-02T08:00:00Z", null, { sport: "running", subSport: "generic" });
  const hidden = await upload("2027-01-03T08:00:00Z");
  await v1(runtime, token, `/activities/${hidden.id}`, {
    method: "PUT",
    json: { fields: { hidden: true } },
  });

  const response = await v1(runtime, token, `/athlete/stats?timezone=Europe/Budapest&at=${at}`);
  assert.equal(response.status, 200, await response.clone().text());
  const stats = await response.json();
  assert.equal(stats.allRideTotals.count, 5, "every ride but the run and the hidden one");
  assert.equal(stats.ytdRideTotals.count, 1, "the Los Angeles ride was last year there");
  assert.equal(stats.recentRideTotals.count, 3);
  assert.equal(stats.recentRideTotals.movingTime, 360);
  assert.equal(stats.recentRideTotals.kilojoules, 72);
  const bad = await v1(runtime, token, "/athlete/stats?timezone=Mars/Olympus_Mons");
  assert.equal(bad.status, 400);
});

test("the athlete is the signed-in rider", async () => {
  const { token } = await signUp(runtime);
  const athlete = await (await v1(runtime, token, "/athlete")).json();
  assert.match(athlete.name, /^Athlete /);
  assert.equal((await v1(runtime, null, "/athlete")).status, 401);
});
```

The stats test reports as of a fixed moment (`at`), so it gives the same answer on any day of
the year, and its rides sit on each boundary: New Year in two time zones, the first and last day
of the four weeks, a ride after the moment, a run and a hidden ride.

Run: `node --test tests/activities.test.mjs`
Expected: new tests FAIL.

- [ ] **Step 2: Implement server edits**

Append to `hosted/apps/api/src/sync/apply.ts`:

```ts
/** An edit made through the API rather than on a device. */
export type ServerEdit =
  | { objectId: string; op: "update"; fields: ActivityUpdate["fields"] }
  | { objectId: string; op: "delete" };

/**
 * Applies an edit with a clock later than every clock the rider's data has seen, so it wins.
 * `not_found` for a ride that does not exist or is deleted; anything but `applied` would mean
 * the clock did not win, which the caller reports rather than claiming success.
 */
export async function applyServerEdit(writer: Writer, edit: ServerEdit) {
  const row = await writer.db
    .select({ deletedAt: activity.deletedAt })
    .from(activity)
    .where(and(eq(activity.id, edit.objectId), eq(activity.userId, writer.userId)))
    .get();
  if (!row || row.deletedAt !== null) return "not_found" as const;
  const clock = serverClock(writer);
  const change: SyncChange =
    edit.op === "update"
      ? {
          changeId: "api",
          objectType: "activity",
          objectId: edit.objectId,
          op: "update",
          fields: edit.fields,
          clock,
        }
      : { changeId: "api", objectType: "activity", objectId: edit.objectId, op: "delete", clock };
  const [result] = await applyChanges(writer, SERVER, [change]);
  return result!.status;
}
```

Change `hosted/apps/api/src/athletes/writer.ts`:

```diff
--- a/hosted/apps/api/src/athletes/writer.ts
+++ b/hosted/apps/api/src/athletes/writer.ts
@@ -3,7 +3,7 @@ import { DurableObject } from "cloudflare:workers";

 import { storeUpload, type UploadInput, type UploadResult } from "../activities/store";
 import { getBlobs, getDb } from "../services";
-import { applyChanges } from "../sync/apply";
+import { applyChanges, applyServerEdit, type ServerEdit } from "../sync/apply";
 import { prune } from "../sync/events";
 import { openWriter, sweep, type Writer } from "../sync/writer";

@@ -58,6 +58,11 @@ export class AthleteWriter extends DurableObject {
     return this.#run(userId, (writer) => applyChanges(writer, deviceId, changes));
   }

+  /** An edit made through the API: `applied`, or why not. */
+  edit(userId: string, edit: ServerEdit) {
+    return this.#run(userId, (writer) => applyServerEdit(writer, edit));
+  }
+
   async alarm() {
     await this.#serialize(async () => {
       const userId = await this.ctx.storage.get<string>("userId");
```

- [ ] **Step 3: Implement the queries**

Create `hosted/apps/api/src/activities/queries.ts`:

```ts
import type { AthleteStats, SummaryActivity } from "@trainstack/contract";
import { and, desc, eq, gt, gte, inArray, isNull, lt, lte, or, type SQL, sql } from "drizzle-orm";

import type { Database } from "../db";
import { activity, type ActivityRow } from "../db/schema";
import { localTimestamp } from "./local-time";
import { toSummary } from "./shape";

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
  return match ? { startDate: Number(match[1]), id: match[2]! } : undefined;
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
/** Strava's recent totals cover the last four weeks: today and the 27 days before. */
const RECENT_DAYS = 28;

/** `day`, a `YYYY-MM-DD`, moved by a number of days. */
const shiftDay = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Strava's ride totals as of `at`, by each ride's local start day. "Today" is `at` in the
 * rider's time zone (UTC without one); the last four weeks are today and the 27 days before,
 * this year is 1 January to today, and both leave out rides dated after today. All time counts
 * every ride. Hidden and deleted rides never count.
 */
export async function athleteStats(
  db: Database,
  userId: string,
  timezone: string | null,
  at: number,
): Promise<AthleteStats> {
  const today = localTimestamp(at, timezone).slice(0, 10);
  const day = sql`substr(${activity.startDateLocal}, 1, 10)`;
  const between = (from: string) => and(gte(day, from), lte(day, today));
  const totals = (window?: SQL) =>
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
          window,
        ),
      );
  const [recent, year, all] = await db.batch([
    totals(between(shiftDay(today, 1 - RECENT_DAYS))),
    totals(between(`${today.slice(0, 4)}-01-01`)),
    totals(),
  ]);
  return { recentRideTotals: recent[0]!, ytdRideTotals: year[0]!, allRideTotals: all[0]! };
}
```

- [ ] **Step 4: Wire the handlers**

Replace `hosted/apps/api/src/router.ts` with:

```ts
import { implement, ORPCError } from "@orpc/server";
import {
  appContract,
  type ChangeProblem,
  type SyncChange,
  syncChangeSchema,
} from "@trainstack/contract";
import { z } from "zod";

import { parseLaps } from "./activities/fit";
import { athleteStats, findLiveActivity, listActivities } from "./activities/queries";
import { CALLS_PER_WINDOW } from "./activities/routes";
import { toSummary } from "./activities/shape";
import { createBudget } from "./budget";
import type { Context } from "./context";
import { getBlobs, getDb, writerOf } from "./services";
import { fitKey } from "./storage";
import { clockProblem } from "./sync/clock";
import { CursorExpired, InvalidPage, manifestPage, pullEvents } from "./sync/events";

const api = implement(appContract).$context<Context>();
const { spend } = createBudget(getDb);

const requireAuth = api.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context: { session: context.session } });
});

/** A signed-in rider within their share of the API: 300 calls every 15 minutes. */
const rider = api.middleware(async ({ context, next }) => {
  if (!context.session?.user) throw new ORPCError("UNAUTHORIZED");
  if (!(await spend(`api:${context.session.user.id}`, CALLS_PER_WINDOW))) {
    throw new ORPCError("RATE_LIMITED", { status: 429 });
  }
  return next({ context: { session: context.session } });
});

/** An activity with what only the FIT file holds, its laps; undefined if it is not live. */
async function detail(userId: string, id: string) {
  const row = await findLiveActivity(getDb(), userId, id);
  const bytes = row && (await getBlobs().get(fitKey(userId, row.fitSha256)));
  // A delete can land between reading the row and the file.
  if (!row || !bytes) return undefined;
  return { ...toSummary(row), description: row.description, laps: parseLaps(bytes) };
}

/**
 * The push's changes, each checked on its own so that every malformed one is reported by index
 * in the same shape, or the problems.
 */
function checkChanges(raw: unknown[], now: number) {
  const changes: SyncChange[] = [];
  const problems: ChangeProblem[] = [];
  raw.forEach((candidate, index) => {
    const parsed = syncChangeSchema.safeParse(candidate);
    if (!parsed.success) {
      problems.push({ index, reason: "invalid_change", message: z.prettifyError(parsed.error) });
    } else if (clockProblem(parsed.data.clock, now) === "ahead") {
      problems.push({ index, reason: "clock_ahead", message: "The clock is too far ahead." });
    } else {
      changes.push(parsed.data);
    }
  });
  return { changes, problems };
}

export const appRouter = api.router({
  healthCheck: api.healthCheck.handler(() => "OK"),
  privateData: api.privateData.use(requireAuth).handler(({ context }) => ({
    message: "This is private",
    user: context.session.user,
  })),
  activities: {
    list: api.activities.list
      .use(rider)
      .handler(({ context, input }) => listActivities(getDb(), context.session.user.id, input)),
    get: api.activities.get.use(rider).handler(async ({ context, input, errors }) => {
      const found = await detail(context.session.user.id, input.id);
      if (!found) throw errors.NOT_FOUND();
      return found;
    }),
    update: api.activities.update.use(rider).handler(async ({ context, input, errors }) => {
      const userId = context.session.user.id;
      const edit = { objectId: input.id, op: "update" as const, fields: input.fields };
      const status = await writerOf(userId).edit(userId, edit);
      if (status === "not_found") throw errors.NOT_FOUND();
      if (status !== "applied") throw errors.CONFLICT();
      const found = await detail(userId, input.id);
      if (!found) throw errors.NOT_FOUND();
      return found;
    }),
    delete: api.activities.delete.use(rider).handler(async ({ context, input, errors }) => {
      const userId = context.session.user.id;
      const status = await writerOf(userId).edit(userId, { objectId: input.id, op: "delete" });
      if (status === "not_found") throw errors.NOT_FOUND();
      if (status !== "applied") throw errors.CONFLICT();
    }),
  },
  athlete: {
    get: api.athlete.get.use(rider).handler(({ context }) => ({
      id: context.session.user.id,
      name: context.session.user.name,
      image: context.session.user.image ?? null,
      createdAt: new Date(context.session.user.createdAt).toISOString(),
    })),
    stats: api.athlete.stats
      .use(rider)
      .handler(({ context, input }) =>
        athleteStats(
          getDb(),
          context.session.user.id,
          input.timezone ?? null,
          input.at ?? Date.now(),
        ),
      ),
  },
  sync: {
    push: api.sync.push.use(rider).handler(async ({ context, input, errors }) => {
      const { changes, problems } = checkChanges(input.changes, Date.now());
      if (problems.length > 0) throw errors.INVALID_CHANGES({ data: { problems } });
      const userId = context.session.user.id;
      const results = await writerOf(userId).applyChanges(userId, input.deviceId, changes);
      return { results, serverTime: Date.now() };
    }),
    events: api.sync.events.use(rider).handler(async ({ context, input, errors }) => {
      try {
        const page = await pullEvents(getDb(), context.session.user.id, input.after, input.limit);
        return { ...page, serverTime: Date.now() };
      } catch (error) {
        if (error instanceof CursorExpired) throw errors.CURSOR_EXPIRED();
        throw error;
      }
    }),
    manifest: api.sync.manifest.use(rider).handler(async ({ context, input, errors }) => {
      try {
        const page = await manifestPage(getDb(), context.session.user.id, input.page, input.limit);
        return { ...page, serverTime: Date.now() };
      } catch (error) {
        if (error instanceof InvalidPage) throw errors.INVALID_PAGE();
        throw error;
      }
    }),
  },
});
```

`notYet` is gone: every procedure has its handler.

- [ ] **Step 5: Run all tests**

Run: `bun run format && bun run test && bun run check`
Expected: PASS (apart from any failures recorded in Task 1, Step 2), lint and format clean.

- [ ] **Step 6: Commit**

```bash
git add hosted/apps/api/src/sync/apply.ts hosted/apps/api/src/athletes/writer.ts \
  hosted/apps/api/src/activities/queries.ts hosted/apps/api/src/router.ts tests/activities.test.mjs
git commit -m "api: list, show, edit and delete activities and total a rider's rides"
```

---

### Task 10: Deleting an account removes its files

**Files:**

- Modify: `hosted/apps/api/src/athletes/writer.ts`
- Modify: `hosted/apps/api/src/auth/index.ts`
- Modify: `hosted/apps/api/src/services.ts`
- Test: `tests/activities.test.mjs` (append)

**Interfaces:**

- Consumes: `athletePrefix`, `getBlobs`, `writerOf` (Task 6).
- Produces: `AthleteWriter.closeAccount(userId: string): Promise<void>`,
  `type AuthHooks = { beforeDeleteUser?: (userId: string) => Promise<void> }`,
  `createAuth(env: AuthConfig, database: Database, desktopOrigins?: readonly string[], hooks?: AuthHooks)`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/activities.test.mjs`:

```js
const deleteAccount = (token) =>
  runtime.dispatchFetch("https://api.trainstackhq.com/api/auth/delete-user", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password: "test-password-12345" }),
  });

test("deleting an account deletes its rides and their files", async () => {
  const { token, userId } = await signUp(runtime);
  const created = await (await uploadFit(runtime, token, ride())).json();
  const deleted = await deleteAccount(token);
  assert.equal(deleted.status, 200, await deleted.clone().text());
  assert.equal((await bucket.list({ prefix: `athletes/${userId}/` })).objects.length, 0);
  assert.equal(
    await db.prepare("SELECT id FROM activity WHERE id = ?").bind(created.id).first(),
    null,
  );
  assert.equal(
    await db.prepare("SELECT seq FROM sync_event WHERE user_id = ?").bind(userId).first(),
    null,
  );
});

test("an upload racing the account's deletion leaves no file behind", async () => {
  const { token, userId } = await signUp(runtime);
  await uploadFit(runtime, token, ride());
  const [, deleted] = await Promise.all([uploadFit(runtime, token, ride()), deleteAccount(token)]);
  assert.equal(deleted.status, 200);
  assert.equal((await bucket.list({ prefix: `athletes/${userId}/` })).objects.length, 0);
  assert.equal(
    await db.prepare("SELECT id FROM activity WHERE user_id = ?").bind(userId).first(),
    null,
  );
});
```

Run: `node --test tests/activities.test.mjs`
Expected: FAIL on the R2 listings.

- [ ] **Step 2: Implement the barrier**

Change `hosted/apps/api/src/athletes/writer.ts`:

```diff
--- a/hosted/apps/api/src/athletes/writer.ts
+++ b/hosted/apps/api/src/athletes/writer.ts
@@ -3,6 +3,7 @@ import { DurableObject } from "cloudflare:workers";

 import { storeUpload, type UploadInput, type UploadResult } from "../activities/store";
 import { getBlobs, getDb } from "../services";
+import { athletePrefix } from "../storage";
 import { applyChanges, applyServerEdit, type ServerEdit } from "../sync/apply";
 import { prune } from "../sync/events";
 import { openWriter, sweep, type Writer } from "../sync/writer";
@@ -14,7 +15,8 @@ const SWEEP_DELAY_MS = 10 * 60 * 1000;
  * The one place a rider's data is written. Cloudflare runs at most one instance of this object
  * per rider, and its queue runs their operations one at a time, so each operation reads the
  * rider's rows and writes them back with no other write in between. D1 stays the store of
- * record: the object keeps only its alarm and the rider's ID for it.
+ * record: the object keeps only its alarm, the rider's ID for it, and the mark that the account
+ * is closing, which has to outlive the rider's rows.
  */
 export class AthleteWriter extends DurableObject {
   #queue: Promise<unknown> = Promise.resolve();
@@ -33,6 +35,9 @@ export class AthleteWriter extends DurableObject {
    */
   #run<T>(userId: string, task: (writer: Writer) => Promise<T>): Promise<T> {
     return this.#serialize(async () => {
+      if (await this.ctx.storage.get<boolean>("closed")) {
+        throw new Error("The account is being deleted.");
+      }
       if (this.#userId !== userId) {
         await this.ctx.storage.put("userId", userId);
         this.#userId = userId;
@@ -63,6 +68,18 @@ export class AthleteWriter extends DurableObject {
     return this.#run(userId, (writer) => applyServerEdit(writer, edit));
   }

+  /**
+   * The barrier before an account is deleted: operations queued before it finish, none after it
+   * write anything, and then every file of the rider's is removed. Safe to call again when a
+   * deletion failed part way.
+   */
+  closeAccount(userId: string) {
+    return this.#serialize(async () => {
+      await this.ctx.storage.put("closed", true);
+      await getBlobs().deletePrefix(athletePrefix(userId));
+    });
+  }
+
   async alarm() {
     await this.#serialize(async () => {
       const userId = await this.ctx.storage.get<string>("userId");
```

The closed mark lives in the writer's own storage because it must outlive the rider's D1 rows,
which the deletion removes.

Change `hosted/apps/api/src/auth/index.ts`:

```diff
--- a/hosted/apps/api/src/auth/index.ts
+++ b/hosted/apps/api/src/auth/index.ts
@@ -13,10 +13,16 @@ export type AuthConfig = {
   CORS_ORIGIN: string;
 };

+export type AuthHooks = {
+  /** Runs before the account's rows go, so a failure leaves the account to try again. */
+  beforeDeleteUser?: (userId: string) => Promise<void>;
+};
+
 export function createAuth(
   env: AuthConfig,
   database: Database,
   desktopOrigins: readonly string[] = [],
+  hooks: AuthHooks = {},
 ) {
   return betterAuth({
     database: drizzleAdapter(database, {
@@ -31,8 +37,15 @@ export function createAuth(
       apple: { clientId: APPLE_APP_BUNDLE_ID, appBundleIdentifier: APPLE_APP_BUNDLE_ID },
     },
     // The app asks to delete the rider's account, as App Review requires wherever accounts are
-    // made. Rows that belong to the user go with it.
-    user: { deleteUser: { enabled: true } },
+    // made. Rows that belong to the user go with it. Files kept outside the database go first.
+    user: {
+      deleteUser: {
+        enabled: true,
+        beforeDelete: async (user) => {
+          await hooks.beforeDeleteUser?.(user.id);
+        },
+      },
+    },
     // Email accounts are not verified, so someone could register a rider's address first and keep
     // the password. Signing in with Apple must never quietly join such an account.
     account: { accountLinking: { enabled: false } },
```

Change `hosted/apps/api/src/services.ts`:

```diff
--- a/hosted/apps/api/src/services.ts
+++ b/hosted/apps/api/src/services.ts
@@ -8,7 +8,9 @@ export function getDb(): Database {
   return createDb(ENV);
 }
 export async function createAuth(database?: Database) {
-  return createConfiguredAuth(ENV, database ?? (await getDb()));
+  return createConfiguredAuth(ENV, database ?? (await getDb()), [], {
+    beforeDeleteUser: (userId) => writerOf(userId).closeAccount(userId),
+  });
 }
 export function getBlobs(): Blobs {
   return r2Blobs(ENV.FILES);
```

- [ ] **Step 3: Run all tests**

Run: `bun run format && bun run test && bun run check`
Expected: PASS (apart from any failures recorded in Task 1, Step 2). `tests/strava.test.mjs` and
`tests/worker.test.mjs` delete accounts too, so they exercise the hook.

- [ ] **Step 4: Commit**

```bash
git add hosted/apps/api/src/athletes/writer.ts hosted/apps/api/src/auth/index.ts \
  hosted/apps/api/src/services.ts tests/activities.test.mjs
git commit -m "api: close a rider's writer and delete their files with their account"
```

---

### Task 11: Document the API and protocol

**Files:**

- Create: `docs/sync.md`
- Modify: `docs/THESIS.md` and `docs/ride-alpha.md`, only where they say rides never leave the
  device (find them with `grep -n -i "device" docs/THESIS.md docs/ride-alpha.md`)

- [ ] **Step 1: Write `docs/sync.md`**

A page for whoever builds sub-project 3 (Ride's side). It links the spec and has these sections,
each with one short example request and response taken from the tests:

1. **Clocks**: the format, the three HLC rules (making, receiving, keeping), the 10-minute rule,
   `server` as a reserved device ID.
2. **Uploading**: `PUT /v1/activities/fit/{sha256}`, its query parameters, and every status:
   `201` created or restored, `200` already live, `409 deleted`, `422 hash_mismatch`,
   `422 invalid_fit`, `413`, `429`.
3. **Pushing changes**: the four change shapes, `applied`, `superseded` and `unknown_object`, the
   two `400` shapes (`BAD_REQUEST` and `INVALID_CHANGES` with `problems`), and the 1 MB cap.
4. **Pulling events**: cursor, `hasMore`, `410 CURSOR_EXPIRED`, the table of event shapes, and
   how a device applies each one (fields and existence by clock, derived values as given).
5. **The manifest**: paging with `next`, using the first page's `cursor`.
6. **What a device keeps**: device ID, HLC, outbox with original clocks, cursor, per-ride sidecar
   with field and existence clocks, zone history entries keyed by day.

Plain sentences, no em dashes.

- [ ] **Step 2: Correct statements that are no longer true**

Wherever the docs say rides stay only on the device, say instead that the server can keep a
signed-in rider's rides and sync them, and that signed-out use keeps them on the device. Ride
does not upload anything until sub-project 3, so say "the server can keep" rather than "Ride
keeps".

- [ ] **Step 3: Check formatting**

Run: `bun run format && bun run check`
Expected: clean.

- [ ] **Step 4: Commit**

Stage only the docs files you changed:

```bash
git add docs/sync.md docs/THESIS.md docs/ride-alpha.md
git commit -m "docs: describe the activity sync API for apps"
```
