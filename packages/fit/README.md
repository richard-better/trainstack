# @trainstack/fit

Decodes a FIT activity file into typed data: a summary, sessions, laps, records and events, for
any sport. It also reads and writes FIT workout files. It has no dependencies and uses no Node APIs, so it runs in Cloudflare Workers and in
the browser.

```ts
import { decodeFit, FitDecodeError } from "@trainstack/fit";

try {
  const { summary, sessions, laps, records, events } = decodeFit(bytes);
} catch (error) {
  if (error instanceof FitDecodeError) error.code;
}
```

`bytes` is a `Uint8Array` or an `ArrayBuffer`. `streamFit(bytes, { untilSeconds, maxRecords })`
returns the same summary, sessions and laps, the timer events, and the records as columns:
`Float64Array`s of seconds since the start, power, heart rate, speed, distance and altitude, with
`NaN` where a record has no value. It reads the file twice, first for the start and the number of
records and then for the columns, so it allocates them once and builds no object per record.
Records more than `untilSeconds` after the start are left out. A file with more records than
`maxRecords` within that time, or more than 20,000 timer events, fails with `tooLarge`. The
server analyses activities this way. `summarizeFit(bytes)` returns the same
`fileId`, `workoutName`, `summary`, `sessions` and `laps` without keeping the records or the
file's messages, for files too large to decode in full in a Worker. `FitDecodeError.code` is one of `notAFitFile`,
`truncated`, `badChecksum`, `malformed`, `noActivity` or `tooLarge`, the last for a file with
more than 10,000 laps or sessions.

- `summary.utcOffsetSeconds` is the activity's local time minus UTC, from the activity message's
  local timestamp, rounded to the minute; it is `undefined` when the file has none or it is more
  than 14 hours. GPX and TCX carry no local time, so theirs is always `undefined`.
- `summary` comes from the file's sessions, summed across them for a multisport activity, and
  falls back to the records for any total the sessions leave out.
- `records` are the streams: time, seconds since the start, power, heart rate, cadence, speed,
  distance, latitude and longitude in degrees, altitude, temperature, and developer fields by
  name, such as Ride's `target_power`.
- Enumerations such as `sport` use the FIT profile's names in camelCase (`cycling`,
  `virtualActivity`), and keep a number the profile does not name.
- Units are SI and named in each field: metres, seconds, metres per second.

## Workouts

```ts
import { decodeFitWorkout, encodeFitWorkout, readFitFileId } from "@trainstack/fit";

const { fileId, name, sport, subSport, poolLengthMeters, steps } = decodeFitWorkout(bytes);
const file = encodeFitWorkout({ name, sport, steps }, { timeCreated: new Date() });
```

`decodeFitWorkout` reads the `workout` and `workout_step` messages of a file whose `file_id`
says it is a workout, and fails with `noWorkout` for any other file, such as an activity, or one
with no steps, and with `tooLarge` past 10,000 steps (`maxWorkoutSteps`). `decodeFit` fails with
`noActivity` on a workout file, and `readFitFileId` tells the two apart. Each step resolves the
FIT profile's dynamic fields into typed values:

- `duration`: `time` in seconds, `distance` in metres, `open` (until the lap button), `repeat`
  (FIT's `repeat_until_steps_cmplt`: go back to the step at index `fromStep` until the steps have
  run `count` times in all), or `other` with the FIT duration type and its raw values.
- `target` and `secondaryTarget`: `power` (an `averaging` of `instant`, `3s`, `10s`, `30s` or
  `lap`), `heartRate` and `speed` (`instant` or `lap`), and `cadence`, each with either a `zone`
  number or a custom `low` and `high`; `swimStroke`; or `other` with raw values. An open target is
  no target. FIT's offsets are undone: a power value above 1000 is watts plus 1000 and anything up
  to 1000 is a percentage of FTP, and a heart rate above 100 is bpm plus 100 and anything up to 100
  is a percentage of max heart rate. Speed is in metres per second, cadence in rpm.
- `name`, `notes`, `intensity` and `equipment`, with the FIT profile's names in camelCase.

`encodeFitWorkout` writes the same shape back as a FIT 2.0 file with a 14-byte header, a header
and file CRC, a `file_id` of type workout from the development manufacturer, the `workout`
message, and one `workout_step` per step, defining each message layout once. It rounds values to
FIT's precision (milliseconds, centimetres, millimetres per second, whole watts, percent, bpm
and rpm) and throws a `RangeError` for a value a field cannot hold.

## Tests

The tests decode the golden FIT files that Ride's Swift tests use, in place under
`apps/ride/RideKit`, and assert the values those tests assert. `test/fit-writer.ts` writes
synthetic files for what the goldens do not cover, such as routes, other sports, compressed
timestamps and big-endian messages. Run them with `bun run test` from the repository root.

`test/fixtures/workouts/` holds workout files laid out the way Garmin Connect, TrainingPeaks and
intervals.icu write them: fixed-size strings, invalid sentinels for unused fields, zones, power
past the 1000 offset, lap-button steps, nested repeats and big-endian messages.
`test/workout-fixtures.ts` writes them, and a test fails when the committed files differ. After
changing it, run `node packages/fit/test/workout-fixtures.ts --write`. Garmin's FIT SDK reads
every fixture and every file `encodeFitWorkout` writes without errors; its licence keeps it out
of this repository (see `LICENSING.md`), so that check runs outside it.
