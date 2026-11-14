# @trainstack/fit

Decodes a FIT activity file into typed data: a summary, sessions, laps, records and events, for
any sport. It has no dependencies and uses no Node APIs, so it runs in Cloudflare Workers and in
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

## Tests

The tests decode the golden FIT files that Ride's Swift tests use, in place under
`apps/ride/RideKit`, and assert the values those tests assert. `test/fit-writer.ts` writes
synthetic files for what the goldens do not cover, such as routes, other sports, compressed
timestamps and big-endian messages. Run them with `bun run test` from the repository root.
