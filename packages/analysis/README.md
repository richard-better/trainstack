# @trainstack/analysis

This package analyses one activity, and the load across many. For one activity it gives normalized
power, intensity and training stress against the FTP of the day, work, the power curve, time in
heart rate, power and pace zones, grade-adjusted pace, best efforts and a stress score from pace
or heart rate. Across activities it gives fitness, fatigue and form per day. It has no Node APIs
and runs in Workers and the browser. It reads the records that `@trainstack/activity-file`
decodes, and the thresholds from `@trainstack/zones`.

```ts
import { decodeActivityFile } from "@trainstack/activity-file";
import { analyzeActivity, statisticsOf, stressByDay, trainingLoad } from "@trainstack/analysis";
import { profileOn } from "@trainstack/zones";

const activity = decodeActivityFile(bytes);
const analysis = analyzeActivity(activity, profileOn(history, day));
analysis.load; // { stressScore: 87, source: "power" }
statisticsOf(analysis); // { normalized_power_w: 231, power_stress_tss: 87, ... }

const days = trainingLoad(stressByDay(activities), "2026-01-01", "2026-06-30");
```

For cycling, the numbers match Ride's analysis in `apps/ride/RideKit/Sources/RideData`
(`PowerCurve`, `TrainingStress`, `TimeInZones`, `TrainingLoad`). See [Parity with Ride](#parity-with-ride).

## Results

`analyzeActivity(activity, profile)` takes anything shaped like a decoded activity, meaning a
`summary` (`startTime`, `sport`, `subSport`, `elapsedSeconds`), `records`, `laps` and `events`, together
with the profile that held on the activity's day. `records` is either an array of records or
columns of them (`AnalysisColumns`), as `streamActivityFile` in `@trainstack/activity-file` gives
them, so the server analyses a 25 MB file without an object per record:

```ts
const activity = streamActivityFile(bytes, analysisColumnLimits);
const analysis = analyzeActivity(activity, profileOn(history, day));
```

The analysis cleans columns in place, so after it the columns hold its samples, not the file's
values. `analysisColumnLimits` keeps a week of records, the most the analysis reads, and refuses
more records in that week than one a second. `columnsOf(records)` turns records into columns.
It returns:

| Field                                | What                                                                 |
| ------------------------------------ | -------------------------------------------------------------------- |
| `normalizedPowerWatts`               | Normalized power, rounded                                            |
| `powerIntensity`, `powerStressScore` | Intensity factor and TSS against the sport's FTP                     |
| `workKilojoules`                     | Work, rounded                                                        |
| `powerCurve`                         | Best average power for 5 s, 15 s, 30 s, 1, 5, 10, 20, 30 and 60 min  |
| `averageGradeAdjustedSpeed`          | Average grade-adjusted speed in m/s, for running                     |
| `normalizedGradeAdjustedSpeed`       | Grade-adjusted speed normalized like power, for running              |
| `paceIntensity`, `paceStressScore`   | Intensity and stress score against threshold pace, for running       |
| `bestEfforts`                        | Fastest 400 m, 1 km, mile, 5 km, 10 km, half marathon and marathon   |
| `heartRateStressScore`               | Stress from heart rate                                               |
| `timeInZones`                        | Seconds and share in each heart rate, power and pace zone            |
| `load`                               | The stress score that counts for fitness and fatigue, and its source |
| `laps`                               | Normalized power, work and average grade-adjusted speed of each lap  |

A value is `null` when its data or threshold is missing. `zoneSport(sport, subSport)` maps a FIT
sport onto a sport in `@trainstack/zones` the same way Ride's `Sport(fitSport:)` does.
Thresholds come from `metricSettings(profile, metric, sport)`, so a sport's own zones override
the default.

### The load

Running uses the pace score, then the power score, then the heart rate score. Every other sport
uses the power score, then the heart rate score. The first one that exists is the load. If none
exists, the activity has no load.

### Statistics

`statisticsOf(analysis)` flattens the result into numbers named `<what>_<unit>`, the way
`activityStatistics` in `packages/contract` names them, so the server can store them as
statistics. `analysisStatistics` lists the names that are always the same. On top of those,
each zone gets `time_in_<metric>_zone_<label>_s`, for example `time_in_power_zone_3_s` or
`time_in_heart_rate_zone_5a_s`. The units are `s`, `mps`, `w`, `kj`, `ratio` (intensity) and
`tss` (stress scores, which all use the TSS scale, so an hour at threshold scores 100).

## Formulas and sources

- **Normalized power, intensity factor and TSS.** These come from Coggan, in Allen & Coggan,
  _Training and Racing with a Power Meter_ (2nd ed., 2010). Normalized power is the fourth
  root of the mean fourth power of the 30 s rolling average of power per second. The intensity
  factor is normalized power over FTP. TSS = duration × IF² / 3600 × 100, where the duration
  is the activity's elapsed time. This is a port of `TrainingStress.swift`.
- **Power curve.** For each duration, this is the highest mean over a window of whole seconds
  of power per second (`PowerCurve.swift`).
- **Work.** This is the sum of power × time over held intervals (`TrainingStress.swift`).
- **Time in zones.** Each held interval counts toward the zone of the value it starts with.
  Pace is the sport's pace distance (`paceDistanceMetres`) over speed, rounded to a second, and
  a speed of zero has no pace (`TimeInZones.swift`).
- **Grade-adjusted pace.** This uses Minetti et al., "Energy cost of walking and running at
  extreme uphill and downhill slopes", _Journal of Applied Physiology_ 93 (2002), 1039-1046.
  The cost of running is
  C(i) = 155.4i⁵ − 30.4i⁴ − 43.3i³ + 46.3i² + 19.5i + 3.6 J/kg/m at grade i, and the
  grade-adjusted speed is speed × C(i) / C(0). The grade is measured over 100 m of distance
  centred on each record: the altitude 50 m ahead, minus the altitude 50 m behind, both
  interpolated, over the distance between them. Near the start and end of the activity the
  window is clipped. A span under 10 m counts as flat. The grade is clamped to ±45 %, the
  range Minetti measured. A record without distance keeps the last grade, and an activity
  without altitude is flat.
- **Pace stress score.** This is TrainingPeaks' rTSS: duration × IF² / 3600 × 100, with
  IF = normalized grade-adjusted speed over threshold speed. TrainingPeaks' normalized graded
  pace is proprietary. Here it is the normalized power algorithm applied to grade-adjusted
  speed per second. Threshold speed is the sport's pace distance over its `threshold_pace`.
- **Heart rate stress score.** This uses Banister's TRIMP, from Morton, Fitz-Clarke & Banister,
  "Modeling human performance in running", _Journal of Applied Physiology_ 69 (1990),
  1171-1177: minutes × HRr × 0.64 × e^(1.92 × HRr), where HRr = (HR − resting) / (max −
  resting), clamped to 0..1. The weighting for women (0.86, 1.67) is not used, since
  TrainStack does not ask for sex. The sum is scaled like TSS, so an hour at lactate threshold
  heart rate scores 100. It needs resting, max and lactate threshold heart rate, in that order.
- **Best efforts.** For each standard distance this is the shortest elapsed time between two
  records that cover it. The start is interpolated to the exact distance. Time spent paused
  inside an effort counts, so a pause can never make an effort faster.
- **Fitness, fatigue and form.** These come from Banister's impulse-response model, as Coggan's
  Performance Manager uses it. Each day, fitness += (stress − fitness) / 42 and
  fatigue += (stress − fatigue) / 7, starting from zero on the first day. Form is fitness −
  fatigue. This is a port of `TrainingLoad.swift`. `trainingLoad(stress, from, through)` takes
  calendar days as `YYYY-MM-DD`, so the caller chooses the athlete's time zone, as Ride's
  calendar does. `stressByDay` adds up the activities' loads per day.
  `combineZoneShares` adds zone time across activities by zone label and name, as Ride's
  `combined()` does.
- **Routes.** `routeOf(columns, pauses)` turns the latitude and longitude columns that
  `streamActivityFile` gives into a route for a map or a thumbnail: Google encoded polylines,
  precision 5, and the bounds `[west, south, east, north]`. It keeps only positions while the
  timer runs (`timerPauses`), drops impossible positions and 0,0, and starts a new segment after
  a pause, a gap of more than 60 s between positions, or a jump faster than 100 m/s, so no
  line crosses the map. Each segment is thinned to points at least 1e-4 degrees apart, then
  simplified with Douglas-Peucker (Douglas & Peucker, "Algorithms for the reduction of the
  number of points required to represent a digitized line or its caricature", _The Canadian
  Cartographer_ 10 (1973), 112-122) at 1e-4 degrees of latitude, with longitude scaled by the
  cosine of the first latitude. The tolerance doubles until all segments together have at most
  300 points; when every segment is down to its two ends, the shortest go. A million positions
  take about 0.1 to 0.2 s. The server stores what it returns, and later trimming, such as privacy
  zones, belongs in this function so the stored route and a map drawn from the file agree.

## Sampling rules

- **Order.** Records are sorted by elapsed time. Ride's FIT files are already in order.
- **Pauses.** When the file has timer events, its timer is stopped from each `stop`, `stopAll`,
  `stopDisable` or `stopDisableAll` until the next `start` (`timerPauses`). The decoders report
  a GPX segment or TCX track break as such a pair. Time while the timer is stopped counts for
  nothing. A record written strictly inside a pause is ignored entirely and changes nothing:
  its values never hold, it never ends another record's hold, and its distance and altitude are
  not used.
- **Holding** (`samplingRule`, in `src/sampling.ts`). While the timer runs, a record's values
  hold until the next record, if that record is at most 30 s later, or until the timer stops,
  whichever comes first. A value never holds across a pause: after a restart nothing holds until
  the first record written while the timer runs. A longer gap is missing data and counts for
  nothing. A file without timer events is read the same way. Every quantity
  holds rather than interpolates, for two reasons:
  - Smart recording writes a record when direction, speed or heart rate changes (Garmin's
    "Smart" data recording setting), so the last written value stands until the next one.
  - For power, a linear ramp between two records invents watts that the fourth power in
    normalized power then amplifies.

  Ride holds values the same way. The ceiling is 30 s because smart-recorded files hold records
  15-30 s apart on steady stretches (the Garmin Connect fixture has 15, 16 and 30 s gaps). It
  stays below GoldenCheetah's FixGaps, which interpolates gaps up to 90 s by default, because a
  held value is a stronger claim than an interpolated one. Time in zones, work, heart rate
  stress and average speeds count only held time.

- **Power per second.** This is the series behind normalized power and the power curve. Each
  record fills the whole seconds of its held time. A record with no held time fills only its
  own second, unless the timer is stopped. Any other second is 0 W, so dropouts and long stops
  lower normalized power, as they do in Ride and in GoldenCheetah's zero-filled gaps.
- **Dropouts.** A record without a value adds nothing to zones or work, and counts as 0 W in
  power per second, as in Ride.
- **Spikes.** A value outside a plausible range is treated as a dropout (`plausibleRanges`):
  power 0-3000 W, heart rate 25-250 bpm, speed 0-50 m/s (12.5 m/s for running), altitude
  −500 to 9000 m. Ride has no rule for spikes.
- **Speed.** When a record has no speed, its speed is the distance since the previous record
  over the time since it, if that time is at most 30 s and the timer did not stop in between.
- **Distance.** Distance never goes backward: a record that reports less than the furthest
  distance so far keeps the furthest.
- **Laps.** A lap runs from its start for its elapsed time, or to the next lap's start when it
  has none. A lap that starts before the previous one ended starts where that one ended, so
  laps never overlap. A lap's normalized power uses the activity's power per second over the
  lap's seconds. Its work and average grade-adjusted speed count held intervals clipped to the
  lap, including the interval that closes it.
- **Length.** Records more than a week after the start are ignored, so a broken timestamp
  cannot allocate a per-second series years long.

### Where this differs from Ride

Ride's Swift holds, pauses and fills power per second by the same rule (`SamplingRule` in
`RideData`), with the pauses from the file's timer events, so the numbers are the same for the
same file. Ride does not sort records, check that values are plausible, derive speed from
distance or stop a week after the start, so a file that needs any of those can still differ.
Ride's own files need none of them.

## Cost

A 24-hour run at 1 Hz with power, heart rate, speed, distance and altitude (86,401 records, 96
laps) takes about 65 ms on an Apple M-series Mac. Beyond the records, it allocates about 11 MB of
typed arrays, around 128 bytes per record. It finishes in a 24 MB V8 heap, 20 MB of which the
records themselves take. `test/cost.test.ts` runs this in a capped child process
(`test/day-long.ts`). Laps cost time in proportion to records plus laps, whatever
the file claims: 40,000 one-second laps over 40,000 records take about 25 ms.

A dense 25 MB FIT file holds a week of 1 Hz records (604,801 with the limits), the most any
file can bring. Streaming and analysing it takes about 1 s on an Apple M-series Mac and about 1.1 s
of CPU in workerd, and peak resident memory grows by 78 MB as a ride and 87 MB as a run, the file
included. GPX and TCX files of 25 MB hold far fewer points and take about 0.5 s and 40 MB.
`test/columns.test.ts` runs these in a Node process with a 16 MB heap (`test/analyze-file.ts`).

## Parity with Ride

`test/fixtures/ride-reference.json` holds the values Ride's Swift code computes for the golden
FIT files (`SampleRide.fit`, the three RideCore traces, a smart-recorded ride with records
5 to 8 s apart, a 45 s dropout and a 60 s timer pause, and two rides restarted without a record
at the restart, with and without a record while stopped, from `test/smart-recorded-ride.ts`), for
four synthetic rides (steady 1 Hz, irregular steps of up to 30 s with missing values,
half-second steps, and one too short for normalized power), and for fitness and fatigue over
126 days. `test/swift-parity.test.ts` requires the TypeScript to give exactly the same numbers.
The synthetic rides come from a seeded generator written in both languages. When Ride's analysis changes, regenerate the fixture on a
Mac:

```sh
packages/analysis/test/reference/generate.sh
```

It compiles `RideData` and `test/reference/Reference.swift` with `swiftc` and writes the
fixture.

## Tests

Run them with `bun run test` from the repository root. `test/analysis.test.ts` includes Ride's
`RideAnalysisTests` and `test/load.test.ts` includes its `TrainingLoadTests`.
`test/runtime.test.ts` bundles the package for the browser and analyses a FIT file inside
workerd.
