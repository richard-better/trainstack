# Activity store and two-way sync

Sub-project 1 of 4 toward shareable athlete profiles. Status: approved design, 2026-10-13.

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
   profile editing, Share Profile button.
4. **Strava compatibility API**: `/api/v3` with Strava's exact shapes and an OAuth2 provider, for
   third-party clients only. TrainStack's own clients never use it.

## Architecture

New modules in `hosted/apps/api/src/`, following the pattern of `strava/` (a Hono route factory
taking its dependencies):

- `storage/`: a `Blobs` interface (`put`, `get`, `delete`, `deletePrefix`) and its R2
  implementation. The self-host build has no runtime wiring yet (`env.server.ts` reads
  `cloudflare:workers`), so a filesystem implementation waits until self-hosting is wired; the
  interface is what keeps that cheap.
- `activities/`: FIT parsing with `@garmin/fitsdk`, summary metrics (NP, IF, TSS, kJ), the
  binary FIT upload and download routes, and activity queries.
- `sync/`: hybrid logical clocks, applying changes with per-field last-write-wins, the event log,
  the manifest, event pruning.
- `budget/`: the atomic rate budget, moved out of `strava/` so both modules share it.

FIT files are parsed inline in the upload request. Ride's files are under 1 MB for a two-hour
ride; the 10 MB cap keeps parsing inside a Worker's CPU limit.

Blob keys are `athletes/<userId>/activities/<sha256>.fit`, built only from the session's user ID
and a validated hex digest.

## Data model (D1)

### `activity`

| Column | Notes |
| --- | --- |
| `id` | `act_<ULID>`, the API identity |
| `user_id` | FK to `user`, cascade |
| `fit_sha256` | hex; unique with `user_id`; the sync identity |
| `source` | `ride` or `import` (from FIT `file_id.manufacturer`) |
| `external_id` | optional client-supplied identifier, as on Strava uploads |
| `start_date` | epoch ms, UTC |
| `timezone` | IANA name the device sent, or null |
| `start_date_local` | ISO local timestamp without offset, derived from `timezone` |
| `elapsed_time`, `moving_time` | seconds |
| `distance` | metres, nullable |
| `average_watts`, `max_watts`, `weighted_average_watts` | nullable; NP computed from records |
| `kilojoules` | nullable; from power records |
| `device_watts` | true when power came from a power meter or trainer |
| `average_heartrate`, `max_heartrate`, `average_cadence` | nullable |
| `trainer` | indoor or virtual sub-sport |
| `fit_sport_type` | sport type parsed from the FIT, used until a rider edits it |
| `workout_name` | from the FIT workout message |
| `fit_ftp` | FTP recorded in the FIT (zones target), if any |
| `ftp` | FTP used for IF/TSS: `fit_ftp`, else synced FTP history, else null |
| `intensity_factor`, `training_stress` | derived from `ftp`, null without one |
| `name`, `name_clock` | editable field and its HLC |
| `description`, `description_clock` | editable |
| `sport_type`, `sport_type_clock` | editable; starts as `fit_sport_type` |
| `hidden`, `hidden_clock` | editable; hidden from feeds and stats later |
| `deleted_at`, `existence_clock` | existence register: null `deleted_at` means live |
| `created_at`, `updated_at` | |

Streams stay in the FIT file. No polylines (all rides are indoor today) and no multisport.

### `settings_entry`

Primary key `(user_id, kind, entry_id)`. `kind` is `zone_change`, `ftp_test` or `preference`.
`value` is JSON validated by the contract, `clock` is its HLC, `deleted_at` marks a tombstone.

Wire shapes (the contract owns them; Ride maps its Codable types onto them in sub-project 3):

- `zone_change`: `entry_id` is the Ride `ZoneHistory.Entry.id`;
  `{ day: "YYYY-MM-DD", changes: ZoneChange[] }`, where a change is
  `{ type: "threshold", threshold: string, scope: string, value: number | null }` or
  `{ type: "choice" | "ownZones" | "listed", ... }` (stored as given).
- `ftp_test`: `entry_id` is `FTPTest.id`; `{ date, kind, ftp, scope }`.
- `preference`: `entry_id` is the preference key; any JSON value.

### `sync_event`

`seq` (global autoincrement, the cursor), `user_id`, `object_type` (`activity` or `settings`),
`object_id`, `aspect_type` (`create`, `update`, `delete`), `updates` (JSON of the fields that
changed, as on Strava webhook events), `clock`, `device_id`, `created_at`.

### `sync_state`

Per user: `pruned_through` (the highest `seq` removed by pruning). A cursor below it gets 410.

## Protocol

### Clocks

Each install has a device ID (UUID). Every change carries a hybrid logical clock, written as
`<ms:15 digits>.<counter:6 digits>.<deviceId>`. Zero-padding makes string order equal clock
order, so the database compares clocks with plain `<`. Responses include `serverTime` so devices
can keep their HLC ahead of the server. The server rejects a clock more than 10 minutes ahead of
its own time. Server-side edits (the `/v1` update and delete) use the device ID `server`.

### Uploading a ride

`PUT /v1/activities/fit/{sha256}?clock=&deviceId=&timezone=&externalId=` with the FIT bytes as the
body.

- The server hashes the body; a mismatch is `422 hash_mismatch` and nothing is stored.
- An unparseable file, or one with no session or records, is `422 invalid_fit` with the parser's
  message. Nothing is stored.
- Order of writes: the blob first, then the activity row and the `create` event in one D1 batch.
  A failed blob write records nothing; a failed D1 write leaves a blob that the retry overwrites,
  since the key is the hash.
- If the activity exists and is live: `200` with it, no event (idempotent).
- If it exists and is deleted: the upload's clock is compared with `existence_clock`. If newer,
  the ride comes back (`deleted_at` cleared, blob restored, `create` event) with all its field
  edits kept; if older, `409 deleted` with the activity.
- New: `201` with the activity.

`GET /v1/activities/{id}/fit` returns the original bytes, to the owner only.

### Pushing changes

`POST /v1/sync/changes` with `{ deviceId, changes }`, at most 500 changes. A change is:

- `{ changeId, objectType: "activity", objectId, op: "update", fields, clock }` where `fields` may
  hold `name`, `description`, `sportType`, `hidden`;
- `{ changeId, objectType: "activity", objectId, op: "delete", clock }`;
- `{ changeId, objectType: "settings", kind, entryId, op: "put", value, clock }`;
- `{ changeId, objectType: "settings", kind, entryId, op: "delete", clock }`.

Each change gets its own result: `applied` (at least one field won, or the same clock was already
applied), `superseded` (nothing won), or `unknown_object`. Retrying a change is safe without a
separate idempotency table: a clock equal to the stored one counts as `applied` and writes
nothing. Malformed changes (unknown field, bad clock, clock too far ahead) fail the whole request
with `400` and per-change reasons, so a buggy client notices.

### Conflict rules

- Activity fields are independent last-write-wins registers. One `UPDATE` sets each field whose
  clock is older than the change's, and returns which won, so concurrent pushes cannot lose a
  newer value.
- Existence is its own register. A delete wins over any earlier existence clock; it does not
  touch field values, so a later re-upload brings back the ride with its newest edits. Edits to a
  deleted ride still apply to its fields but do not bring it back.
- Deleting a ride deletes its blob too. A re-upload stores it again.
- Settings entries are whole-entry last-write-wins with tombstones.
- Events carry clocks. Devices apply incoming events with the same last-write-wins rule, so the
  order events land in the log does not matter.

### Pulling changes

`GET /v1/sync/events?after=<seq>&limit=<1..500, default 500>` returns
`{ events, next, hasMore, serverTime }`. `create` events for activities carry the summary and the
`fitSha256`; devices download FIT files they lack via `GET /v1/activities/{id}/fit`.

Events older than 180 days are pruned when the rider pulls. If `after` is below the rider's
`pruned_through`, the answer is `410 cursor_expired`, and the device recovers from the manifest.

### Manifest

`GET /v1/sync/manifest` returns `{ cursor, activities, settings, serverTime }`: every activity
(including tombstones) with its fields and clocks, and every settings entry (including
tombstones). `cursor` is read before the rows, so a device that continues from it may see events
it already reflects, which the LWW rule makes harmless. Used on first sign-in and after a 410.

Tombstones are kept forever: they are small and they are what keeps a device that was offline for
a year from bringing a deleted ride back.

## TrainStack API (`/v1`)

Contract-first in `packages/contract`, served by a second `OpenAPIHandler` mounted at `/v1`
(the existing `/rpc` and `/api-reference` stay). Binary FIT routes are Hono routes under the same
prefix, like the `strava/` module.

- `GET /v1/athlete/activities?before&after&cursor&limit`: `SummaryActivity[]` newest first, live
  only, with `next` cursor.
- `GET /v1/activities/{id}`: `DetailedActivity` (summary plus `description`, `laps`).
- `PUT /v1/activities/{id}`: `UpdatableActivity` (`name`, `description`, `sportType`, `hidden`),
  applied as a sync change with a server clock.
- `DELETE /v1/activities/{id}`.
- `GET /v1/athlete`: id, name, image, createdAt (profile fields arrive in sub-project 2).
- `GET /v1/athlete/stats`: `recentRideTotals` (last 28 days), `ytdRideTotals`, `allRideTotals`,
  each `{ count, distance, movingTime, elapsedTime, kilojoules, trainingStress }`, live and
  not hidden only, in SQL. Year and window boundaries use each activity's local start date.
- `POST /v1/sync/changes`, `GET /v1/sync/events`, `GET /v1/sync/manifest`.

`SummaryActivity`: `id`, `name`, `sportType` (`Ride`, `VirtualRide`, `Workout`, ...),
`startDate`, `startDateLocal`, `timezone`, `elapsedTime`, `movingTime`, `distance`,
`averageWatts`, `maxWatts`, `weightedAverageWatts`, `kilojoules`, `deviceWatts`,
`averageHeartrate`, `maxHeartrate`, `averageCadence`, `trainer`, `hidden`, plus TrainStack's
`trainingStress`, `intensityFactor`, `workoutName`, `fitSha256`.

### Metrics

- NP: 30-second rolling average of 1 Hz power (records resampled to whole seconds, gaps filled
  with zero up to 5 s, longer gaps ending the window), fourth power mean, fourth root. Null under
  30 s of power.
- kJ: sum of power over seconds / 1000.
- IF = NP / FTP. TSS = (seconds × NP × IF) / (FTP × 3600) × 100, using moving time.
- FTP: the FIT's own, else the Default-scope (`scope: "all"`) FTP threshold in effect on the
  activity's local day per synced zone changes (the first entry's when the ride is older than all
  of them), else null. Sport-specific FTPs are not used on the server yet.
- When a zone change is applied or removed, IF and TSS are recomputed in one SQL statement for the
  rider's activities that have no FIT FTP.

## Errors, limits, security

- `401` without a session. Another rider's activity is `404`, never `403`.
- `413 too_large` over 10 MB, read as a stream with the existing `readBody`.
- `422 hash_mismatch`, `422 invalid_fit`, `409 deleted`, `400` for malformed sync requests,
  `410 cursor_expired`.
- Budgets per rider per 15 minutes: 60 uploads, 300 other sync and API calls, with the shared
  atomic `spend`. Over budget is `429 rate_limited`.
- Every query is scoped by the session's user ID.
- Deleting an account deletes its D1 rows by cascade and, before that, everything under
  `athletes/<userId>/` in R2 (a Better Auth `beforeDelete` hook, so a failure leaves the account
  in place to retry).

## Testing

`node --test` against the real Worker in Miniflare (D1 and R2), as `tests/strava.test.mjs` does.
Fixtures: Ride's `SampleRide.fit` and a Garmin-recorded indoor ride. Pure functions (HLC, NP,
TSS) are tested by bundling the module with rolldown.

- FIT: summary fields, NP and kJ against hand-computed values, invalid files, oversized bodies.
- Sync: per-field LWW across two simulated devices, delete beating an earlier edit, edits after a
  delete, re-upload restoring with newest edits, stale re-upload refused, retried changes,
  clocks too far ahead, paging, pruning and 410, manifest recovery.
- API: list paging, stats across year and window boundaries and time zones, update and delete
  producing events, isolation between riders, account deletion removing blobs.

## Out of scope

Per-activity visibility and profile fields (sub-project 2), the app side (3), the Strava-shaped
compatibility API (4), streams in the API, laps that can be edited, kudos, comments, segments,
maps.
