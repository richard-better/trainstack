# @trainstack/logbook

The model of sessions an athlete logs by hand rather than records to a file: strength training
and bouldering. It holds what was lifted or climbed, and derives the numbers lifters and
climbers look at. It has no dependencies beyond zod and runs in Workers and the browser.

A logged session (`loggedSessionSchema`) has a start, a duration, an optional name and notes, an
optional session RPE, and a `detail` whose `sport` says which model it follows. What a watch
records of the same session, such as heart rate, stays in its file; the API links the two as
one workout.

## Strength

Modelled on how Hevy, Strong and a paper log record a session: exercises in the order they were
done, each with its sets.

- An exercise is a lift from `exerciseCatalogue`, by its slug, or one of the athlete's own
  (`customExerciseSchema`), by its UUID. Each names its equipment, the muscles it trains first
  and second, whether sets count reps or a held time, and whether the body is the load.
- Exercises next to each other with the same `group` are done together, a set of each in turn:
  two make a superset, more a circuit.
- A set has a `kind` (`warm_up`, `working`, `drop` or `failure`), reps or a time, and a load:
  a `weight`; the athlete's `bodyweight`; bodyweight `weighted` with added weight; or bodyweight
  `assisted` by a band or machine. A set may also have an RPE (1 to 10 in halves), reps in
  reserve, a tempo (`3-1-X-0`: lowering, pause, lifting, pause, in seconds) and the rest after it.
- Every mass is stored as the athlete entered it, a value and `kg` or `lb`, so nothing is lost
  to rounding. Numbers convert at exactly 0.45359237 kg per pound. A dumbbell set holds the
  weight of one dumbbell.

### Numbers

Warm-up sets count toward none of these. Bodyweight loads count the athlete's body mass on the
day when it is known, plus added weight or minus assistance; when it is not known, those sets
add reps but no weight.

| Number                | Definition                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------- |
| Volume                | The sum over sets of reps times load, in kilograms                                           |
| Heaviest              | The heaviest load lifted for at least one rep                                                |
| Estimated one-rep max | Epley: load × (1 + reps / 30), the best over sets of 1 to 12 reps; a single is its load      |
| Most reps             | The most reps in one set                                                                     |
| Longest               | The longest hold, for exercises measured in time                                             |
| Personal record       | One of the above above every earlier session of the same exercise; a first session sets none |

Epley's formula grows less reliable past about ten reps, so sets of more than 12 give no
estimate.

## Bouldering

Modelled on KAYA, Vertical-Life and Griptonite: a session at a gym or a crag, and each problem
tried, with its grade and how it went.

- A grade is a Font grade (`3` to `9A`), a V grade (`VB` to `V17`), or a colour of the
  session's `circuit`: a gym's colours, easiest first, each with the Font range the gym gives
  it or none.
- A problem has the attempts made in the session, an outcome, and optionally a name, styles
  (crimpy, slopey, dynamic and so on), the wall's angle, notes and the rest after it. The
  outcome is `flash` (topped first try, never tried before, so one attempt), `send` (topped for
  the first time after more attempts), `repeat` (topped again) or `project` (not topped).

### Converting grades

`vToFont` is the table. Each Font grade belongs to one V grade, and a V grade covers one or two
Font grades:

| V   | Font    | V   | Font    | V   | Font |
| --- | ------- | --- | ------- | --- | ---- |
| VB  | 3       | V6  | 7A      | V12 | 8A+  |
| V0  | 4, 4+   | V7  | 7A+     | V13 | 8B   |
| V1  | 5       | V8  | 7B, 7B+ | V14 | 8B+  |
| V2  | 5+      | V9  | 7C      | V15 | 8C   |
| V3  | 6A, 6A+ | V10 | 7C+     | V16 | 8C+  |
| V4  | 6B, 6B+ | V11 | 8A      | V17 | 9A   |
| V5  | 6C, 6C+ |     |         |     |      |

Font to V is therefore exact. V to Font takes the easiest Font grade the V grade covers, so V3
reads as 6A. A colour converts through the Font range its gym gives, by the easier end; a
colour without a range does not convert. Colours of the same circuit compare by the circuit's
order, ranges or not; other grades compare by the easier end of their Font range, then the harder,
and a colour without a range does not compare with them.

### Numbers

| Number        | Definition                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tops          | Problems flashed, sent or repeated                                                                                                               |
| Sends         | First ascents: flashes and sends                                                                                                                 |
| Attempts      | All attempts in the session, on every problem                                                                                                    |
| Hardest top   | The hardest problem topped, and the hardest flashed                                                                                              |
| Grade pyramid | First ascents and projects per grade in one scale, hardest first; repeats are left out, and problems that do not convert are counted as ungraded |

## Training load

Neither sport has power or pace, and heart rate undercounts lifting and climbing, so their load
comes from the athlete's own rating. The athlete gives a session RPE once the session is over,
on Foster's 0 to 10 scale (Foster et al., 2001, "A new approach to monitoring exercise
training"). `sessionLoad` returns two numbers:

- `sessionRpeLoad`: Foster's session RPE load, RPE times minutes, in arbitrary units.
- `stressScore`: an estimate on the same scale as TSS, so it can sit in fitness, fatigue and
  form beside rides and runs: hours times the TSS per hour Joe Friel gives for each RPE in
  "Estimating Training Stress Score" (TrainingPeaks): 20 at RPE 1, then 30, 40, 50, 60, 70, 80,
  100, 120 and 140 at RPE 10, with half points halfway between. RPE 0 is rest and scores 0.

It is an estimate from a feeling, not a measurement. A session without an RPE has no load.
