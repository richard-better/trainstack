# Activity store and two-way sync

Sub-project 1 of 4 toward shareable athlete profiles. Status: approved design, 2026-10-13,
revised after review the same day.

## Why

Riders want a Strava-like athlete profile with a link they can share. Today Ride keeps rides only
as `.fit` files on the device, and the TrainStack account exists only to hold the Strava
connection. A profile needs the rides on the server, and once they are there they must stay in
step with every device the rider uses. So the first piece is a server copy of every ride (the
original FIT file plus a parsed summary), two-way sync of rides and rider settings, and a
Strava-shaped TrainStack API the app uses.

## Roadmap

Each sub-project gets its own spec, plan and PR.

1. **Activity store and two-way sync** (this spec): FIT files in R2, parsed activities in D1, sync
   protocol, TrainStack API at `/v1`.
2. **Athlete profile and share link**: handle, display name, bio, location, avatar, privacy, the
   public page at `trainstackhq.com/athletes/<handle>`, Open Graph image, link and QR code.
   Public reads go through separate `/public/*` routes, never through the owner routes below.
3. **Ride integration**: sync store in the app (outbox, cursor, HLC, per-ride metadata sidecar),
   profile editing, Share Profile button. See "What Ride must do" below.
4. **Strava compatibility API**: `/api/v3` with Strava's exact shapes and an OAuth2 provider, for
   third-party clients only. TrainStack's own clients never use it.

## Architecture

New modules in `hosted/apps/api/src/`, following the pattern of `strava/` (a Hono route factory
taking its dependencies):

- `athletes/`: `AthleteWriter`, a Durable Object with one instance per rider, named by user ID.
  Every write to a rider's data goes through it (see "One writer per rider").
- `storage/`: a `Blobs` interface (`put`, `get`, `delete`, `deletePrefix`) and its R2
  implementation.
- `activities/`: FIT decoding and parsing, summary metrics (NP, IF, TSS, kJ), the binary FIT
  upload and download routes, and activity queries.
- `sync/`: hybrid logical clocks, applying changes, the event log, the manifest, event pruning,
  file cleanup.
- `budget/`: the atomic rate budget, moved out of `strava/` so both modules share it.

FIT files are decoded by our own reader, a TypeScript port of Ride's `FITDecoder.swift`. Garmin's
FIT SDK is not used: its license grants use for internal business purposes only and forbids
combining it with code under a license like ours. FIT files are parsed inline in the upload
request, in the Worker, before the writer sees them. Ride's files are under 1 MB for a two-hour
ride; the 10 MB cap keeps parsing inside a Worker's CPU limit.

Blob keys are `athletes/<userId>/activities/<sha256>.fit`, built only from the session's user ID
and a validated hex digest.

### One writer per rider

All mutations of a rider's data run inside their `AthleteWriter`, one at a time: storing and
restoring uploads, applying sync changes, API edits and deletes, settings changes and the IF and
TSS recomputation they cause, deleting files, pruning events, and the account deletion barrier.
Cloudflare runs at most one instance of a Durable Object, and the object queues its operations
in memory, so an operation reads the rider's rows, decides, and writes them back with no other
write in between. Read-then-write code is plain sequential code; no statement needs to guard
against a concurrent writer.

D1 stays the store of record. The writer calls D1 and R2; it keeps in its own storage only its
alarm, the rider's ID for the alarm, and the mark that the account is closing, which has to
outlive the rider's D1 rows. Reads (lists, details, stats, events, manifest) go straight to D1.
The two reads that must be consistent with pruning (an events page, the first manifest page)
read the prune watermark and their rows in one D1 batch, which D1 runs as one transaction.

Self-hosting has no Durable Objects. It will need an equivalent per-rider lock around the same
operations: an in-process mutex keyed by user ID when one server process owns the database, or
a database lock when several do. The `Blobs` interface keeps the storage side cheap; the
filesystem implementation waits until self-hosting is wired (`env.server.ts` reads
`cloudflare:workers` today).

## Data model (D1)

### `activity`

| Column                                                  | Notes                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `id`                                                    | `act_<ULID>`, the API identity                                                  |
| `user_id`                                               | FK to `user`, cascade                                                           |
| `fit_sha256`                                            | hex; unique with `user_id`; the sync identity                                   |
| `source`                                                | `ride` or `import` (from FIT `file_id.manufacturer`: 255, development, is Ride) |
| `external_id`                                           | optional client-supplied identifier, as on Strava uploads                       |
| `start_date`                                            | epoch ms, UTC                                                                   |
| `timezone`, `timezone_clock`                            | IANA name; editable, so a device can correct it                                 |
| `start_date_local`                                      | derived: ISO local timestamp without offset, from `timezone`                    |
| `elapsed_time`, `moving_time`                           | seconds                                                                         |
| `distance`                                              | metres, nullable                                                                |
| `average_watts`, `max_watts`, `weighted_average_watts`  | nullable; NP computed from records                                              |
| `kilojoules`                                            | nullable; from power records                                                    |
| `device_watts`                                          | true when the file has power readings                                           |
| `average_heartrate`, `max_heartrate`, `average_cadence` | nullable                                                                        |
| `trainer`                                               | indoor or virtual sub-sport, or a Ride file                                     |
| `fit_sport_type`                                        | sport type parsed from the FIT, used until a rider edits it                     |
| `workout_name`                                          | from the FIT workout message                                                    |
| `fit_ftp`                                               | FTP recorded in the FIT (zones target), if any                                  |
| `ftp`                                                   | derived: `fit_ftp`, else the synced FTP of the local day, else null             |
| `intensity_factor`, `training_stress`                   | derived from `ftp`, null without one                                            |
| `name`, `name_clock`                                    | editable field and its HLC                                                      |
| `description`, `description_clock`                      | editable                                                                        |
| `sport_type`, `sport_type_clock`                        | editable; starts as `fit_sport_type`                                            |
| `hidden`, `hidden_clock`                                | editable; hidden from feeds and stats                                           |
| `deleted_at`, `existence_clock`                         | existence register: null `deleted_at` means live                                |
| `created_at`, `updated_at`                              |                                                                                 |

Streams stay in the FIT file. No polylines (all rides are indoor today) and no multisport.

### `settings_entry`

Primary key `(user_id, kind, entry_id)`. `kind` is `zone_change`, `ftp_test` or `preference`.
`value` is JSON validated by the contract, `clock` is its HLC, `deleted_at` marks a tombstone.
Entry IDs are 1 to 128 of letters, digits and `.`, `_`, `:`, `-`.

Wire shapes (the contract owns them; Ride maps its Codable types onto them in sub-project 3):

- `zone_change`: `entry_id` is the local day, `YYYY-MM-DD`; the value is
  `{ changes: ZoneChange[] }` (1 to 64 changes), where a change is
  `{ type: "threshold", threshold: string, scope: string, value: positive integer | null }` or
  `{ type: "choice" | "ownZones" | "listed", ... }` (stored as given).
- `ftp_test`: `entry_id` is `FTPTest.id`; `{ date, kind, ftp, scope }`.
- `preference`: `entry_id` is the preference key; any JSON value.

Every value is at most 16 KB of JSON.

### `sync_event`

`seq` (global autoincrement, the cursor), `user_id`, `object_type` (`activity` or `settings`),
`object_id`, `aspect_type` (`create`, `update`, `delete`), `updates` (JSON, shapes below),
`clock`, `device_id`, `created_at`.

### `sync_state`

Per user: `pruned_through` (the highest `seq` removed by pruning; a cursor below it gets 410) and
`clock` (the server's HLC for the rider: the highest clock it has made or seen).

### `pending_blob`

`(user_id, fit_sha256)`: a FIT file whose presence in R2 may not match its activity row yet.
See "Files and failures".

## Protocol

### Clocks

Each install has a device ID (a UUID; `server` is reserved). Every change carries a hybrid
logical clock, written as `<ms:15 digits>.<counter:6 digits>.<deviceId>`. Zero-padding makes
string order equal clock order, so the server compares clocks as strings. Two clocks at the same
millisecond and counter are ordered by device ID.

Every node, device or server, keeps `last`, the highest clock it has made or seen, and follows
three rules:

- **Making a clock** for a new change at wall time `now`: if `now > last.ms`, the clock is
  `(now, 0)`; otherwise `(last.ms, last.counter + 1)`. A counter that would pass 999999 moves to
  `(last.ms + 1, 0)` instead. The new clock becomes `last`. It is always greater than `last`, so
  clocks from one node are unique and increasing.
- **Receiving**: every clock in an event, a manifest or a response raises `last` to it if it is
  greater. A device also treats `serverTime` as a wall time no earlier than its own.
- **Keeping**: a device writes `last` to disk before it uses a clock, so a restart never makes
  one twice. A change keeps the clock it was made with through every retry and any time offline.

The server refuses a change whose clock is more than 10 minutes ahead of its own time. Its own
changes (the `/v1` update and delete, and recomputed derived values) use device ID `server` and a
clock made from the rider's `sync_state.clock`, which the writer advances past every clock it
receives for the rider. A server change therefore always wins against every value it can see,
however far ahead a device's clock was.

A clock names one change. Two changes with the same clock are the same change: the server keeps
what it stored first and answers `applied` without comparing contents. A device that sends
different content under a clock it already used has a bug the server does not repair.

### Uploading a ride

`PUT /v1/activities/fit/{sha256}?clock=&deviceId=&timezone=&externalId=` with the FIT bytes as the
body. The Worker validates the query, hashes and parses the body, then hands the parsed ride to
the rider's writer.

- A hash mismatch is `422 hash_mismatch` and nothing is stored.
- A file the reader rejects (see "Reading FIT files") is `422 invalid_fit` with a message for the
  rider. Nothing is stored.
- Existence is a last-write-wins register with `existence_clock`. Uploads and deletes are its
  writes, and the result never depends on the order they arrive in:
  - no activity with this hash: create it, `201`;
  - upload clock greater than `existence_clock`: the ride is live with this clock, whether it
    was deleted (`201`, restored with all its field edits kept) or already live (`200`); either
    way a `create` event carries its whole state;
  - upload clock not greater, ride live: `200`, nothing changes;
  - upload clock not greater, ride deleted: `409 deleted` with the activity.
- `timezone` and `externalId` come from the upload that creates the row. Later uploads of the same
  file do not change them. The time zone is corrected with an edit (`fields.timezone`), which
  moves the local start and the FTP the ride is scored with. `externalId` is the uploading
  client's own reference and is never changed.

`GET /v1/activities/{id}/fit` returns the original bytes, to the owner only.

### Pushing changes

`POST /v1/sync/changes` with `{ deviceId, changes }`, at most 500 changes and 1 MB of JSON. A
change is:

- `{ changeId, objectType: "activity", objectId, op: "update", fields, clock }` where `fields` may
  hold `name`, `description`, `sportType`, `hidden`, `timezone`;
- `{ changeId, objectType: "activity", objectId, op: "delete", clock }`;
- `{ changeId, objectType: "settings", kind, entryId, op: "put", value, clock }`;
- `{ changeId, objectType: "settings", kind, entryId, op: "delete", clock }`.

Each change gets its own result: `applied` (at least one field won, or the same clock was already
stored), `superseded` (nothing won), or `unknown_object` (no such activity for this rider; a
device that has not finished uploading a ride retries the change after the upload). Retrying is
safe without an idempotency table, because an equal clock writes nothing.

The writer applies a push as one transaction: it reads the rows the push touches, applies the
changes in order in memory, recomputes derived values where they moved, and writes the rows,
events and file marks in one D1 batch. A push that fails changes nothing, and the device sends
it again.

Errors:

- A body that is not `{ deviceId, changes }` (bad device ID, more than 500 changes) is oRPC's
  `400 BAD_REQUEST` with its validation issues.
- A well-formed body with any bad change is `400 INVALID_CHANGES` with
  `data: { problems: [{ index, reason, message }] }`, one problem per bad change, and nothing is
  applied. `reason` is `invalid_change` (fails the change schema: unknown field, bad clock, value
  too large) or `clock_ahead`. `message` is for people.
- A body over 1 MB is `413` before it is parsed.

### Conflict rules

- Activity fields (`name`, `description`, `sportType`, `hidden`, `timezone`) are independent
  last-write-wins registers, each with its own clock.
- Existence is its own register (see "Uploading a ride"). A delete newer than the existence clock
  deletes the ride; it does not touch field values, so a later re-upload brings back the ride
  with its newest edits. Edits to a deleted ride still apply to its fields but do not bring it
  back.
- Deleting a ride deletes its file too. A re-upload stores it again.
- Settings entries are whole-entry last-write-wins with tombstones. A zone change entry is a
  whole day: two devices editing the same day settle on the later one's changes for that day,
  rather than merging them.
- Derived values (`startDateLocal`, `ftp`, `intensityFactor`, `trainingStress`) are not
  registers. The server works them out from the activity, its time zone and the zone history, and
  publishes them in events. Devices never compute or edit them; they take them from the latest
  event or manifest that carries them.

### Derived values

When a push changes the zone history, the writer works out the derived values of every ride
without its own FTP (deleted ones too), in the same transaction. When a push changes a ride's
time zone, it does so for that ride. Every ride whose values changed gets an `update` event from
device `server` carrying `{ derived: { startDateLocal, ftp, intensityFactor, trainingStress } }`.
An upload computes them when it creates the row. One formula (`trainingLoad` in `metrics.ts`)
serves every case.

### Pulling changes

`GET /v1/sync/events?after=<seq>&limit=<1..500, default 500>` returns
`{ events, next, hasMore, serverTime }`. A page also stops once its events pass 1 MB of JSON, but
always holds at least one.

Event shapes:

| Object   | `aspectType`       | `updates`                                                                | `clock`             |
| -------- | ------------------ | ------------------------------------------------------------------------ | ------------------- |
| activity | `create`           | the whole `ManifestActivity`: facts, fields, derived values, every clock | the existence clock |
| activity | `update`           | `{ fields?: { ... }, derived?: { ... } }`                                | the change's clock  |
| activity | `delete`           | null                                                                     | the existence clock |
| settings | `create`, `update` | `{ value }`                                                              | the entry's clock   |
| settings | `delete`           | null                                                                     | the entry's clock   |

Devices apply events in `seq` order: a `create` they lack becomes the activity; otherwise each
field and the existence register take the incoming value if its clock is greater (a `create`'s
field clocks are in `updates.clocks`, not its event clock); derived values are taken as given;
settings entries are replaced if the clock is greater. Devices download FIT files they lack via
`GET /v1/activities/{id}/fit`.

**Replay rule.** A device that applies the manifest and then every event after its cursor, in
order, holds exactly what the server holds once it has caught up: the same fields, clocks,
existence, derived values and settings. The same holds for a device that applies every event
from the start of a log that was never pruned. Tests check both.

The rider's writer prunes events older than 180 days at the start of each operation. If `after`
is below the rider's `pruned_through`, the answer is `410 cursor_expired`, and the device
recovers from the manifest. The watermark and the page are read in one D1 batch, so pruning can
never slip between the check and the read.

### Manifest

`GET /v1/sync/manifest?page=<token>&limit=<1..500, default 500>` returns
`{ cursor, activities, settings, next, serverTime }`: every activity (including tombstones) with
its fields, derived values and clocks, then every settings entry (including tombstones). Pages
hold one list each, activities by ID first, and stop at `limit` items or after 1 MB of JSON.
`next` is the token for the following page, null after the last; an unknown token is
`400 INVALID_PAGE`. Used on first sign-in and after a 410.

`cursor` is read before the first page and carried through every token. A change that lands
while the device pages is in the events after the cursor; seeing it twice is harmless, because
registers merge by clock and derived values follow event order.

Tombstones are kept forever: they are small and they are what keeps a device that was offline for
a year from bringing a deleted ride back.

### Files and failures

R2 and D1 cannot share a transaction, so the writer orders its writes and marks files that may
disagree with their rows:

- An upload that writes a file first marks it in `pending_blob`, then writes it to R2, then
  writes the row, its event and the removal of the mark in one batch.
- A delete writes the tombstone, its event and the mark in one batch, then deletes the file.
- The sweep settles every marked file: one whose ride is live stays, any other is deleted, then
  the mark goes. It runs after every writer operation, and from the writer's alarm, which every
  operation sets for 10 minutes later if none is set. A file left by an upload that died between
  R2 and D1, or a delete whose R2 call failed, is gone within minutes, and the sweep retries until
  it succeeds.

Partial failures resolve the same way everywhere: a D1 batch either commits or changes nothing,
the device retries anything that did not answer, a retry with the same clock is a no-op, and the
sweep repairs R2. A live row always has its file, because the file is written before the row and
deleted only after the row says deleted.

### Deleting an account

Better Auth's `beforeDelete` hook calls the writer's `closeAccount`. It runs after every
operation queued before it, marks the account closed in the writer's own storage, and deletes
everything under `athletes/<userId>/` in R2. Every later operation for the rider fails without
writing. Then Better Auth deletes the user and D1 deletes the rows by cascade. A failure in the
hook leaves the account in place to retry; the account stays closed for writes.

## TrainStack API (`/v1`)

Contract-first in `packages/contract`, served by a second `OpenAPIHandler` mounted at `/v1`
(the existing `/rpc` and `/api-reference` stay). Binary FIT routes are Hono routes under the same
prefix, like the `strava/` module. Every JSON body the oRPC handlers read is capped at 1 MB.

- `GET /v1/athlete/activities?before&after&cursor&limit`: `SummaryActivity[]` newest first, live
  only, with `next` cursor.
- `GET /v1/activities/{id}`: `DetailedActivity` (summary plus `description`, `laps`).
- `PUT /v1/activities/{id}`: `{ fields: UpdatableActivity }` (`name`, `description`,
  `sportType`, `hidden`, `timezone`), applied by the writer with a server clock. `404` for a
  deleted or unknown ride, and `409 CONFLICT` if the change did not win, which the server clock
  rules out but the API checks rather than assumes.
- `DELETE /v1/activities/{id}`: the same, `204` on success.
- `GET /v1/athlete`: id, name, image, createdAt (profile fields arrive in sub-project 2).
- `GET /v1/athlete/stats?timezone&at`: `recentRideTotals`, `ytdRideTotals`, `allRideTotals`,
  each `{ count, distance, movingTime, elapsedTime, kilojoules, trainingStress }`, over live,
  not hidden rides (`Ride`, `VirtualRide`), in SQL. "Today" is `at` (default now) in `timezone`
  (default UTC). Each ride counts by its own local start day: recent is today and the 27 days
  before, year to date is 1 January to today, both inclusive and both leaving out rides dated
  after today; all time counts every ride.
- `POST /v1/sync/changes`, `GET /v1/sync/events`, `GET /v1/sync/manifest`.

`SummaryActivity`: `id`, `name`, `sportType` (`Ride`, `VirtualRide`, `Workout`, ...),
`startDate`, `startDateLocal`, `timezone`, `elapsedTime`, `movingTime`, `distance`,
`averageWatts`, `maxWatts`, `weightedAverageWatts`, `kilojoules`, `deviceWatts`,
`averageHeartrate`, `maxHeartrate`, `averageCadence`, `trainer`, `hidden`, plus TrainStack's
`ftp`, `trainingStress`, `intensityFactor`, `workoutName`, `fitSha256`.

## Reading FIT files

The reader checks the header and the file CRC, then decodes definition and data messages,
including compressed timestamp headers and developer fields (skipped). The parser accepts a file
only when it is:

- an activity (`file_id.type` 4);
- one session with a start time and a total elapsed time of at most a week. A file with more
  than one session (multisport) is refused with a message saying so;
- at least one record, every record with a timestamp;
- laps, if any, each with a start time and a total elapsed time.

Anything else, including any error thrown while decoding, becomes `InvalidFit` and a `422`.
Checking laps at upload means a stored file can always be read again for its detail.

## Metrics

- **When the rider was riding.** The timer events (`event` timer, `start` and the stop types)
  give the intervals the timer ran, clipped to the session. A file without timer events ran for
  the whole session. Time with the timer stopped (auto-pause, a real pause) is neither riding nor
  zero watts.
- **Power for each second.** Within a running interval, each second takes the reading of the
  latest record at or before it, so a reading holds until the next record. This is what Smart
  Recording means: Garmin writes a record when something changes, from every second to several
  seconds apart. A record without power ends a stretch of readings (a dropout), as does a pause.
  Records are sorted by timestamp first; of two in one second, the later in the file counts.
- **NP**: 30-second rolling average within each stretch, fourth-power mean, fourth root. Null
  without a full 30-second window.
- **kJ**: sum of the per-second power / 1000; null without any power reading.
- **Average and max power, heart rate and cadence**: the session's own values, else computed
  from the per-second values the same way.
- **IF** = NP / FTP. **TSS** = (moving seconds × NP × IF) / (FTP × 3600) × 100. Null when NP or
  FTP is null; a ride with NP 0 has IF and TSS 0.
- **FTP**: the FIT's own, else the Default-scope (`scope: "all"`) FTP threshold in effect on the
  activity's local day per the synced zone history (the first entry's when the ride is older
  than all of them, as Ride's `ZoneHistory` does), else null. Sport-specific FTPs are not used on
  the server yet.

## Errors, limits, security

- `401` without a session. Another rider's activity is `404`, never `403`.
- `413 too_large` for a FIT body over 10 MB and for any JSON body over 1 MB, read as a stream
  with `readBody` so neither is buffered past the cap.
- `422 hash_mismatch`, `422 invalid_fit`, `409 deleted`, `400 INVALID_CHANGES`,
  `400 BAD_REQUEST`, `400 INVALID_PAGE`, `409 CONFLICT`, `410 cursor_expired`.
- Settings values at most 16 KB of JSON; descriptions at most 10,000 characters; event and
  manifest pages at most 500 items and about 1 MB. D1 rows stay far below 2 MB.
- Budgets per rider per 15 minutes: 60 uploads, 300 other sync and API calls, with the shared
  atomic `spend`. Over budget is `429 rate_limited`.
- Every query is scoped by the session's user ID. The writer is named by it.

## What Ride must do (sub-project 3)

- Keep a device ID, an HLC with the rules above, an outbox of changes with their original
  clocks, the event cursor, and a per-ride sidecar with each field's clock and the existence
  clock.
- Map `ZoneHistory` entries to settings entries keyed by their day. Moving an entry to another
  day is a delete of the old day and a put of the new one. Two devices editing the same day keep
  the later device's entry for that day, so Ride's one-entry-per-day rule holds after sync.
  `ZoneHistory.Entry.id` stops being part of the sync identity.
- Show derived values (IF, TSS, FTP, local start) as the server sends them, and never write them.
- Upload a ride before pushing changes to it; push again after `unknown_object` once the upload
  has succeeded.
- Keep writing FIT files as `FITEncoder.swift` does; the server's tests build files the same way
  (`makeRideFit`), and the two must change together.

## Testing

`node --test` against the real Worker in Miniflare (D1, R2 and the Durable Object), as
`tests/strava.test.mjs` does. Pure functions (HLC, FIT reader and parser, NP, TSS, the FTP
timeline) are tested by bundling the module with rolldown.

Fixtures, all built without Garmin's SDK:

- `SampleRide.fit`, a Garmin Edge 530 file (manufacturer 1, cycling, generic sub-sport, 1 Hz):
  the Garmin import fixture.
- `makeRideFit`, a test helper that writes exactly the messages of Ride's `FITEncoder.swift`,
  including manufacturer 255 and the `target_power` developer field: the Ride fixture.
- `makeFit`, a test helper that writes Garmin-style files with options for Smart Recording
  intervals, timer pauses, laps, extra sessions and deliberately broken messages.

Coverage:

- FIT: summary fields of each fixture, NP and kJ against hand-computed values, Smart Recording,
  pauses, dropouts, out-of-order records, NP 0 against null, every rejected structure.
- Sync: per-field LWW across two devices, equal clocks, concurrent identical pushes, delete
  beating an earlier edit, edits after a delete, restore events carrying field clocks,
  existence independent of arrival order (sequential and concurrent), stale re-upload refused,
  orphaned files swept, malformed changes and oversized bodies, same-day zone entries, derived
  values reaching devices, time zone corrections, an upload racing a zone change, paging, pruning
  and 410, manifest paging, and the replay rule from the start and from a mid-way manifest.
- API: list paging, detail, edits winning over device clocks ahead of the server, stats at a
  fixed moment across year, window and time zone boundaries, isolation between riders, account
  deletion removing files, also with an upload racing it.

## Out of scope

Per-activity visibility and profile fields (sub-project 2), the app side (3), the Strava-shaped
compatibility API (4), streams in the API, laps that can be edited, multisport files, kudos,
comments, segments, maps.
