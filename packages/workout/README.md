# @trainstack/workout

The typed workout model TrainStack stores, edits and plays, with import and export of `.zwo`,
`.erg`, `.mrc` and FIT workout files. It has no Node-only APIs, so it runs
in Cloudflare Workers and the browser, and `test/runtime.test.ts` runs it in workerd.

## The model

`workoutSchema` is the zod schema and `Workout` its type. A workout has a `name`, a `sport`
(`cycling`, `running` or `swimming`) and `steps`, plus an optional `description`, `author`,
`focus` (the training zone it works, as Ride's library labels workouts) and `tags`.

Each block in `steps` is either:

- a `step`, which lasts a `duration` of `{ type: "time", seconds }`,
  `{ type: "distance", meters }` or `{ type: "open", expected? }` (see
  [Lap-button steps](#lap-button-steps)), or
- a `repeat`, which runs its own `steps` `count` times. Repeats nest.

A step's `target` is one of:

| `type`      | `unit`                                            | Meaning                                         |
| ----------- | ------------------------------------------------- | ----------------------------------------------- |
| `power`     | `ftp` (1 is FTP) or `watts`                       | Power                                           |
| `pace`      | `threshold` (1 is threshold) or `metersPerSecond` | Speed. A share above 1 is faster than threshold |
| `heartRate` | `threshold` (1 is threshold) or `bpm`             | Heart rate                                      |
| `maxEffort` |                                                   | All out                                         |

A step without a target is a free ride: the athlete chooses. Power, pace and heart rate carry a
`level`:

- `constant`: hold `value`.
- `range`: stay between `low` and `high`.
- `ramp`: move steadily from `from` at the step's start to `to` at its end.

Pace is stored as speed so that shares and ranges read the same way for every metric, and so one
unit serves running per kilometre and swimming per 100 metres alike. Shares are fractions, not
percentages: 0.85 is 85%.

A step can also carry a `cadence` (constant or range, in rpm or steps per minute), an
`intensity` (`warmUp`, `active`, `recovery`, `rest` or `coolDown`), a `name`, `notes`, and
`cues`: interval text shown at an offset into the step, by time or distance. A cue on a step
inside a repeat shows in every iteration; a cue on the repeat itself shows once, at its offset
from the repeat's start.

`flatten` expands repeats into the plain sequence of steps a player runs, placing each repeat
cue on the step it falls in. `totals` adds up a workout's time and distance.

### Lap-button steps

A step with `duration: { type: "open" }` lasts until the athlete presses the lap button, as
coaches write warm-ups, recoveries and cool-downs for outdoor use. `expected`, a time or a
distance, is the author's or importer's estimate of how long it takes. It is for planning only:
it never ends the step, and a step without it has an unknown length, never zero.

- A player runs the step until the athlete presses lap, holding its target as for any step and
  counting time and distance up. It may show `expected` as a hint, never as a countdown.
- An open step takes any target but a ramp, which needs a known length, so the schema refuses a
  ramp on an open step.
- A cue on an open step shows at its offset from the step's start, if the athlete gets that far.
  `flatten` places a repeat cue that falls at or after an open step's start in that step, since
  the step has no known end.
- `totals` keeps what is certain apart from what is estimated: `seconds` and `meters` count only
  steps measured in time and distance, and `open` gives the number of open `steps` (repeats
  counted out), how many are `withoutExpected`, and the `expectedSeconds` and `expectedMeters`
  of those that have an estimate.
- Workouts stored before open steps existed parse unchanged.

## Files

`parseZwo`, `parseErg` and `parseMrc` read a file into a workout, and `writeZwo`, `writeErg` and
`writeMrc` write one out. `parseWorkout` and `writeWorkout` take these text formats by name
(`workoutFormats`). `parseFit` reads FIT bytes and `writeFit` writes them. `parseWorkoutFile(fileName,
content, options)` picks the reader from the extension among `workoutFileFormats`, and takes text or
bytes; a `.fit` file must come as bytes.

Every conversion returns `{ value, warnings }`. It throws a `WorkoutFormatError`, listing every
issue it found, when the file is malformed or the target format cannot express what the workout
asks the athlete to do: a target type, a range, a distance step. What does not change the effort
but has nowhere to go (names, notes, intensity, cadence in `.erg`, tags, repeat structure) is left
out and reported in `warnings`.

Only FIT has lap-button steps. Zwift's `FreeRide` is a step with no target that still lasts a
set `Duration`, so it reads as a timed step without a target, and `.zwo`, `.erg` and `.mrc` have
no step that waits for the athlete. Their writers throw on an open step, unless `approximate` is
set: then an open step is written as a step of its `expected` length, reported as
`approximated`, and one without an expected length still throws. Converting a workout to a format and back keeps its `flatten`ed
timeline.

Power in watts and power as a share of FTP convert into each other only when the writer is given
an `ftp`. Readers keep targets as the file states them.

| Format | Holds                                                                                                                                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.zwo` | Zwift workouts for bike (power as a share of FTP) and run (pace as a share of threshold), timed or by distance, with ramps, ranges, `IntervalsT` repeats, free ride, max efforts, cadence and text events. Other repeats are written out step by step. |
| `.erg` | Timed power in watts, constant or ramped, with course text.                                                                                                                                                                                            |
| `.mrc` | Timed power as a percentage of FTP, constant or ramped, with course text.                                                                                                                                                                              |
| `.fit` | Workouts for Garmin, Wahoo and COROS devices: timed, by distance or until the lap button, power, heart rate, speed and cadence, constant or ranged, repeats, names, notes and intensity. See [FIT](#fit).                                              |

Zwift's `pace` attribute picks a reference pace for run workouts (one mile, 5 km and so on).
The model has one threshold pace, so a run file's reference pace is read as threshold and
reported. Zwift writes `pace="0"` on bike steps too, where it means nothing and is ignored.

## FIT

FIT is how a workout reaches a Garmin, Wahoo or COROS device. `@trainstack/fit` reads and writes
the messages; this package maps them to the model.

`writeFit(workout, options)` writes time, distance and lap-button (`open`) steps, power as a percentage of FTP or in
watts, heart rate in bpm, pace as speed, cadence (as the secondary target beside another),
constant levels and ranges, repeats, names, notes, intensity and sport. FIT repeats point back to
a step and cannot nest, so a repeat inside a repeat is written out, choosing which level to write
out so the file has the fewest steps. It throws when FIT cannot say what the workout asks:

- Heart rate or pace as a share of threshold, unless `thresholdHeartRate` (bpm) or
  `thresholdPace` (metres per second) is given to turn it into bpm or speed.
- A ramp, or a max effort, unless `approximate` is set. Then a ramp becomes a staircase of
  steady steps of equal length, one per 60 seconds or 200 metres of the ramp and at least two,
  each at the ramp's level at its midpoint, so the length and the average stay the same to FIT's
  precision. A max effort becomes a step with no target named "All out". Each is reported as
  `approximated`.
- Power above 1000% of FTP, or a value too large for its field.

Values are rounded to FIT's precision, with an `approximated` warning when that changes one. A
name or note longer than FIT's 254 bytes is cut, reported as `dropped`. FIT has no field for an
open step's `expected` length, so it is reported as `dropped`.

`parseFit(bytes, options)` reads a FIT workout file. A lap-button step reads as an open step
with no `expected` length, whether the file leaves its duration value out, invalid or zero, as
Garmin Connect, TrainingPeaks, TrainerRoad and ZWO converters write them. `options.athlete` holds the athlete's `maxHeartRate` and `zones`, or is a function from the workout's sport to them, since the sport is known only once the file is read. It throws for what the model cannot hold:

- A step that lasts until a heart rate, power, calories or anything but a time, a distance or
  a lap-button press. The error names the step.
- A zone target, unless `zones` gives the athlete's `heartRate`, `power` or `speed` zones as
  `{ low, high }` in bpm, watts or metres per second, numbered from 1. A zone then becomes its
  range, reported as `converted` with the zones' `source`. A zone with no upper limit is refused.
- Heart rate as a percentage of max heart rate, unless `maxHeartRate` is given to turn it into
  bpm, reported as `converted`.
- A sport other than cycling, running or swimming, grade and resistance targets, repeats that do
  not form a nested run of steps, and repeats nested more than 32 deep (`maxRepeatDepth`).

`fitAthlete(profile, sport, source)` and `athleteThresholds(profile, sport)` take an athlete's
settings as `@trainstack/zones` replays them (`profileOn`) and give the reader's zones and max
heart rate, and the writer's threshold heart rate and pace, so the API and the web app read and
write a file the same way.

The sub sport, pool length, swim stroke and equipment have nowhere to go and are reported as
`dropped`, as is lap or short-window averaging on a power, heart rate or speed target.

## Ride's library

`test/fixtures/ride-library.json` is `WorkoutTemplate.library` from `RideData`, encoded by Swift,
and `test/ride-library.test.ts` converts every workout in it. The hosted API serves the same file,
`hosted/apps/api/src/workouts/ride-library.json`, as its built-in library, and
`tests/ride-library-source.test.mjs` fails when either copy differs from the Swift source. When the
library changes, regenerate both on a Mac:

```sh
cat > Dump.swift <<'SWIFT'
import Foundation
@main enum Dump {
  static func main() throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    FileHandle.standardOutput.write(try encoder.encode(WorkoutTemplate.library))
  }
}
SWIFT
swiftc -parse-as-library -o dump $(ls apps/ride/RideKit/Sources/RideData/*.swift | grep -v SampleRide.swift) Dump.swift
./dump | tee packages/workout/test/fixtures/ride-library.json > hosted/apps/api/src/workouts/ride-library.json
```
