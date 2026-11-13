# @trainstack/activity-file

Decodes an activity file of any format TrainStack accepts, FIT, GPX or TCX, into one shape. It
tells the format from the content, not the file name. Like `@trainstack/fit`, it has no Node
APIs and no `DOMParser`, so it runs in Cloudflare Workers and in the browser.

```ts
import { ActivityFileError, decodeActivityFile } from "@trainstack/activity-file";

try {
  const { format, name, summary, laps, records, events } = decodeActivityFile(bytes);
} catch (error) {
  if (error instanceof ActivityFileError) error.code;
}
```

`bytes` is a `Uint8Array` or an `ArrayBuffer`.

`summarizeActivityFile(bytes)` returns only `format`, `name`, `summary` and `laps`, equal to
the full decode's. It folds each record into running totals as it reads, and keeps neither the
records nor FIT's raw messages nor an XML tree, so a 25 MB file of any format summarizes inside a
Worker. The server uses it; the browser uses the full decode.

`decodeGpx` and `decodeTcx` decode one format,
and `detectActivityFileFormat` returns `"fit"`, `"gpx"`, `"tcx"` or `undefined` without
decoding.

- `summary`, `laps`, `records` and `events` have the types `@trainstack/fit` gives them, so a
  summary has the same fields whatever the format. A FIT file decodes to exactly what
  `decodeFit` returns.
- `name` is a GPX track's name, or a FIT file's workout name. TCX has none.
- `ActivityFileError.code` is one of `unrecognizedFormat`, `tooLarge`, `truncated`,
  `malformed`, `badChecksum` or `noActivity`, and `format` says which format was being read.
  A FIT error keeps the `FitDecodeError` as its `cause`.

## GPX and TCX

- GPX 1.0 and 1.1 track points become records. Extensions are read by element name, whatever
  their namespace prefix: Garmin's TrackPointExtension (`hr`, `cad`, `atemp`, `speed`), Garmin's
  PowerExtension (`PowerInWatts`), Strava's `power`, and Apple Health's `speed`. Routes and
  waypoints are not activities and are ignored.
- TCX laps become laps, with the totals the lap and its `LX` extension carry. Track points
  become records, with `TPX` speed, power and run cadence.
- A point without a readable time is skipped, as `decodeFit` skips a record without a
  timestamp. A file with no timed points, and no TCX laps, fails with `noActivity`.
- A new GPX track segment, or a new track within a TCX lap, is a pause. It gives a
  `timer`/`stopAll` and `timer`/`start` event pair, and the timer time leaves the pause out.
- Totals the file carries come first, as they do for FIT sessions. Otherwise the summary is
  computed from the points: distance from the points' own distances, or along their positions
  within each segment; average speed as distance over timer time; averages and maxima of the
  records; ascent and descent from altitude changes of at least 3 metres.
- `<type>` and `Sport` map to FIT's sport names, such as `cycling` with sub-sport `road` for
  Garmin Connect's `road_biking`.
- Text is read as UTF-8, or UTF-16 when the file starts with its byte order mark.

## Untrusted input

Files over 64 MiB, and files with more than 10,000 laps or sessions, fail with `tooLarge`. The XML reader scans bytes once and keeps no document
tree. It never expands entities a DOCTYPE declares, and rejects nesting deeper than 64
elements or more than 64 attributes on one element. It keeps at most 4 KiB of text per
element. Time grows linearly with size, and the tests check that on input crafted to be slow.

## Tests

`test/summary.test.ts` writes a dense 25 MB file of each format and summarizes it in a Node
process capped at a 16 MB heap, in which the full decode of the same file runs out of memory.

`test/files` holds GPX and TCX files written the way Strava, Garmin Connect, Wahoo, Apple
Health and GPSBabel write them. The FIT tests use `@trainstack/fit`'s golden files. Run them
with `bun run test` from the repository root.
