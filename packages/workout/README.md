# @trainstack/workout

The typed workout model TrainStack stores, edits and plays, with import and export of `.zwo`,
`.erg` and `.mrc` files. It has no Node-only APIs, so it runs
in Cloudflare Workers and the browser.

## The model

`workoutSchema` is the zod schema and `Workout` its type. A workout has a `name`, a `sport`
(`cycling`, `running` or `swimming`) and `steps`, plus an optional `description`, `author`,
`focus` (the training zone it works, as Ride's library labels workouts) and `tags`.

Each block in `steps` is either:

- a `step`, which lasts a `duration` of `{ type: "time", seconds }` or
  `{ type: "distance", meters }`, or
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

## Files

`parseZwo`, `parseErg` and `parseMrc` read a file into a workout, and `writeZwo`, `writeErg` and
`writeMrc` write one out. `parseWorkoutFile(fileName, text)` picks the reader from the
extension, and `parseWorkout` and `writeWorkout` take the format by name.

Every conversion returns `{ value, warnings }`. It throws a `WorkoutFormatError`, listing every
issue it found, when the file is malformed or the target format cannot express what the workout
asks the athlete to do: a target type, a range, a distance step. What does not change the effort
but has nowhere to go (names, notes, intensity, cadence in `.erg`, tags, repeat structure) is left
out and reported in `warnings`. Converting a workout to a format and back keeps its `flatten`ed
timeline.

Power in watts and power as a share of FTP convert into each other only when the writer is given
an `ftp`. Readers keep targets as the file states them.

| Format | Holds                                                                                                                                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.zwo` | Zwift workouts for bike (power as a share of FTP) and run (pace as a share of threshold), timed or by distance, with ramps, ranges, `IntervalsT` repeats, free ride, max efforts, cadence and text events. Other repeats are written out step by step. |
| `.erg` | Timed power in watts, constant or ramped, with course text.                                                                                                                                                                                            |
| `.mrc` | Timed power as a percentage of FTP, constant or ramped, with course text.                                                                                                                                                                              |

Zwift's `pace` attribute picks a reference pace for run workouts (one mile, 5 km and so on).
The model has one threshold pace, so a run file's reference pace is read as threshold and
reported. Zwift writes `pace="0"` on bike steps too, where it means nothing and is ignored.
