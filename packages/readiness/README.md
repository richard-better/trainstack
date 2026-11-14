# @trainstack/readiness

How ready an athlete is to train on a day, worked out from what Trainstack holds: the athlete's
daily check-in (`docs/check-in.md`), the sleep, resting heart rate and HRV their devices measured
(today from Apple Health, through Ride), and their training load (`@trainstack/analysis`).
It says how ready they are on four worded levels, which inputs drove it, how sure it is given
what is missing, and what it would change about each session planned for the day. It is pure
code with no dependency beyond `@trainstack/analysis`, and runs in Workers and the browser.

It is not Whoop's recovery, Garmin's training readiness or Oura's readiness, which rest mostly on
what a device measures. Here the measured values are one input beside the check-in and the load,
each against the athlete's own usual, and a day without them says so (`basis.unmeasured`). It never
diagnoses: illness and injury are what the athlete said, and the answer to them is rest or less,
never a judgement of how ill or how hurt.

## Use

```ts
import { readinessOn, readinessRange } from "@trainstack/readiness";

const today = readinessOn({ checkIns, stress, planned, measured }, "2026-11-14");
const month = readinessRange({ checkIns, stress, planned, measured }, "2026-10-15", "2026-11-14");
```

- `checkIns`: the athlete's check-ins, any order. Readiness reads the day's own and the 28 days
  before it. A check-in with no rating, illness or injury, such as only a note, counts as none.
- `stress`: daily training stress by day (`stressByDay` of the activities' `load_tss`), all of it.
  Fitness, fatigue and form are worked out from the first day, exactly as `training.load` does.
- `planned`: each day's planned items with their state and planned seconds and load, as the
  calendar holds them.
- `measured` (optional): each day's `sleepSeconds` (asleep in the night before), `restingHeartRateBpm`
  and `hrvMs`, any of them null, from one source. Readiness reads the day's own and up to 60 days
  before it.

## What a day says

| Field         | What it is                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `level`       | `ready`, `fair`, `low` or `poor`; null when there is nothing to go on                                                     |
| `reasons`     | Every input that was read, illness and injury first, then what lowers readiness most                                      |
| `gaps`        | What was missing or too short: no check-in, a short baseline, too little training history                                 |
| `confidence`  | `high`, `medium` or `low`, from the gaps                                                                                  |
| `basis`       | Whether there was a check-in, how many days made the baseline, how long the training history is, and what is not measured |
| `suggestions` | One per workout still to do that day: its intensity and `as_planned`, `ease`, `swap_easy` or `rest`                       |

## The model

Each input that points to strain adds a weight. The weights add up to a level, and illness and
injury then set the level no better than they allow.

### The check-in, against the athlete's own usual

For each of the five ratings the athlete gave (sleep, energy, soreness, stress, mood):

- **Usual** is the mean of that rating over the 28 days before, from at least 7 check-ins, leaving
  out days marked ill, rounded to the nearest anchor (a half rounds up). Without rounding, a
  second bad day in a row lowers the mean just enough that the same answers no longer count as
  below usual. Rounding stops that drift from deciding the weight, except where the mean sits
  near a half: half 3s and half 4s make 3.5, which rounds to 4, and one more 3 tips it to 3. With fewer, usual is 3, the scale's "Normal": the check-in's scale is
  anchored on the athlete's own normal, so it is a fair fallback, but a person who habitually
  answers 4 reads better against their own mean. Comparing with the athlete's own recent normal
  rather than a population is how wellness questionnaires are meant to be read (McLean and others
  2010; Gastin and others 2013; Saw and others 2016).
- **One point below usual** (one worded anchor) weighs 1; **two points below** weighs 2. One
  anchor is the smallest change the 1-to-5 scale can show; a z-score against the athlete's
  standard deviation would be the finer test, but on a five-point scale that deviation is coarse
  and often near zero in a steady month. One point or more above usual is shown as raising
  readiness but does not offset strain elsewhere.
- Each item weighs the same, as in the McLean and Hooper sums.

The 28-day window and the minimum of 7 are our choice: long enough to hold a block's ordinary
ups and downs, short enough to follow a change of season or job.

### Training load

Fitness, fatigue and form are the 42- and 7-day exponential averages of `@trainstack/analysis`,
read as they stood at the end of the day before. The day's own training is left out: readiness is
the morning's.

- **Not before 84 days of history** (twice the fitness time constant). Both averages start from
  zero on the first loaded day, and fatigue fills seven times faster than fitness, so in the first
  weeks form reads as deep fatigue for anyone who trains steadily. At 84 days fitness has reached
  86 % of where steady training takes it. Before that, and while fitness is below 10, load says
  nothing and the gap says why.
- **Form as a share of fitness.** Above +5 % is fresh (raises), -10 % to +5 % neutral, -30 % to
  -10 % building (a block doing its job, weight 0), below -30 % deep (weight 2). These are Joe
  Friel's form bands as Intervals.icu applies them to form as a share of fitness; they are a
  coach's rule of thumb, not a finding.
- **A fast ramp.** Fitness more than 8 above where it was a week earlier weighs 1. Friel puts 5 to
  8 a week as about right for most athletes (TrainingPeaks, "Why ramp rate is an important
  training metric").
- **Hard days in a row.** A hard day has stress at least 1.5 times the fitness going into it,
  half again the athlete's average day. Two in a row before today weigh 1, three or more 2, after
  the hard-easy principle behind Foster's monotony (Foster 1998). The 1.5 is our choice.
- **Load alone weighs at most 3**, so training alone never takes readiness below fair. Form and
  hard days often come from the same days and would otherwise count twice, and a block is meant
  to tire: how the athlete feels decides whether it is too much, which is where self-reported
  measures do better than objective ones (Saw and others 2016).

### Levels

| Weight    | Level   | Said as                                  |
| --------- | ------- | ---------------------------------------- |
| 0 to 1    | `ready` | Nothing points against the plan          |
| 2 to 3    | `fair`  | Some strain: go easier on the hard parts |
| 4 to 5    | `low`   | Run down: keep the day easy              |
| 6 or more | `poor`  | Strongly run down: rest                  |

A single poor night (two points below usual) makes `fair`; that and tired legs, `low`; feeling
worse than usual on most items, `poor`. These cut points are our choice.

### Illness and injury

- **Ill today**: `poor`, and every session is rest. Return-to-sport guidance for acute
  respiratory illness is to stop and come back gradually (Schwellnus and others 2022). The
  common "neck check", training through symptoms above the neck, is not used: it was never
  validated and its use has been challenged. Trainstack does not judge how ill someone is.
- **Ill on any of the 7 days before** and not today: no better than `fair`, so a hard session is
  eased while coming back. The 7 days are our choice.
- **Injured, cannot train** (the OSTRC answer): `poor`, rest. **Trains less**: no better than
  `low`. **Trains fully**: shown, with no weight.

Confidence is `high` when the athlete is ill or cannot train, since that is their own word.

### Confidence

- `low`: no check-in on the day, so readiness comes from training and measured values alone; or no
  level at all.
- `medium`: a check-in, but fewer than 7 earlier check-ins that rated each item rated that day, a
  gap in training history, or a measured value with too few days before it.
- `high`: neither.

### Suggestions

The planned session's intensity comes from its planned load and time. Its intensity factor is
√(load ÷ (100 × hours)), the inverse of TSS. Below 0.75 is easy, 0.75 to 0.85 moderate, 0.85 or
more hard, after Allen and Coggan's intensity factor by kind of ride (recovery below 0.75,
endurance 0.75 to 0.85, tempo and above from 0.85). A session whose load is at least 1.5 times
fitness is hard too, by the same rule as a hard day, so a long endurance day counts; this needs
fitness to be read, so not in the first 84 days. Without a
planned load or time it is `unknown` and treated as moderate.

| Level   | Easy       | Moderate   | Hard       |
| ------- | ---------- | ---------- | ---------- |
| `ready` | as planned | as planned | as planned |
| `fair`  | as planned | as planned | ease       |
| `low`   | as planned | ease       | swap easy  |
| `poor`  | rest       | rest       | rest       |

Only workouts still to do get one. Nothing is changed for the athlete: a suggestion is a
proposal they act on through the calendar's own writes.

**For plan adaptation.** A suggestion names the planned workout, its action, its intensity and
its planned load and time, and the day's reasons say why. Plan adaptation can read the same
values to change the plan itself; `ease` and `swap_easy` are directions, not prescriptions, and
the amount belongs to the plan.

### Measured sleep, resting heart rate and HRV

Each is read against the athlete's own usual from the same source, never against a population,
and only on a day that has a value. A value without enough days before it is a gap
(`short_measured_baseline`), not a reason.

- **Sleep**: seconds asleep in the night before, every source's sleep merged so no minute counts
  twice, against the mean of the 28 days before (at least 7). One hour short weighs 1, two hours
  2; an hour more than usual raises. Kept apart from the check-in's sleep, which is the athlete's
  own judgement: a night can be short and still feel fine, and the two can both count. Timing is
  not read yet.
- **Resting heart rate**: the day's value against the mean of the 28 days before (at least 7). 5
  bpm above usual weighs 1, 10 bpm 2; 5 below raises. A resting heart rate raised by several beats
  over the athlete's own norm is a common sign of incomplete recovery, illness coming on or heat
  and alcohol the night before (Buchheit 2014); the 5 and 10 are our choice.
- **HRV**: the night's value (Apple Health measures SDNN; another source's rMSSD would be compared
  only with its own history) as its natural log, against the mean and standard deviation of the
  log over the 60 days before (at least 14), after Plews and others 2013. 1.5 standard deviations
  below weighs 1, 2.5 below 2; 1.5 above raises. The standard deviation is taken as at least 0.1
  (about 10 %), so a very steady month does not turn ordinary noise into strain. Plews reads a
  7-day rolling mean for trends over a block; a day's own value is read here because readiness is
  about the morning, at the cost of more noise, which the 1.5 is chosen to absorb.
- **Measured together weigh at most 3**, so a device alone never takes readiness below fair: a bad
  night is a reason to go easier on the hard parts, and how the athlete feels decides more, since
  self-reported measures track the training response better than objective ones (Saw and others
  2016). A bad night and a check-in that says so too add up.

## Sources

- Buchheit M. Monitoring training status with HR measures: do all roads lead to Rome? _Front
  Physiol_. 2014;5:73.
- McLean BD, Coutts AJ, Kelly V, McGuigan MR, Cormack SJ. Neuromuscular, endocrine, and perceptual
  fatigue responses during different length between-match microcycles in professional rugby league
  players. _Int J Sports Physiol Perform_. 2010;5(3):367-383.
- Hooper SL, Mackinnon LT. Monitoring overtraining in athletes. _Sports Med_. 1995;20(5):321-327.
- Gastin PB, Meyer D, Robinson D. Perceptions of wellness to monitor adaptive responses to training
  and competition in elite Australian football. _J Strength Cond Res_. 2013;27(9):2518-2526.
- Saw AE, Main LC, Gastin PB. Monitoring the athlete training response: subjective self-reported
  measures trump commonly used objective measures: a systematic review. _Br J Sports Med_.
  2016;50(5):281-291.
- Foster C. Monitoring training in athletes with reference to overtraining syndrome. _Med Sci
  Sports Exerc_. 1998;30(7):1164-1168.
- Allen H, Coggan A. _Training and Racing with a Power Meter_. VeloPress; 2nd ed. 2010.
- Friel J. "Why ramp rate is an important training metric". TrainingPeaks.
  https://www.trainingpeaks.com/learn/articles/why-ramp-rate-is-an-important-training-metric/
- Intervals.icu fitness chart, form zones as a share of fitness, after Friel.
  https://forum.intervals.icu/t/zones-of-form-in-fitness-chart/3623
- Schwellnus M, Adami PE, Bougault V, and others. International Olympic Committee (IOC) consensus
  statement on acute respiratory illness in athletes part 1: acute respiratory infections. _Br J
  Sports Med_. 2022;56(19):1066-1088.
- Plews DJ, Laursen PB, Stanley J, Kilding AE, Buchheit M. Training adaptation and heart rate
  variability in elite endurance athletes: opening the door to effective monitoring. _Sports Med_.
  2013;43(9):773-781.
