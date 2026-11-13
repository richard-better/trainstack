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

`bytes` is a `Uint8Array` or an `ArrayBuffer`. `FitDecodeError.code` is one of `notAFitFile`,
`truncated`, `badChecksum`, `malformed` or `noActivity`.

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
