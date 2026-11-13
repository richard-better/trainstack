# @trainstack/workout

The typed workout model TrainStack stores, edits and plays. It has no Node-only APIs, so it runs
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
