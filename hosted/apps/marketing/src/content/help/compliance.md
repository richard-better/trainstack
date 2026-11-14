---
title: "Planned and done: compliance"
summary: What the score on a planned workout means, how each part is scored, and why a part is not scored.
section: Plan
order: 31
---

When an activity is paired with a planned workout, TrainStack scores how closely it followed the
plan, from 0 to 100, and puts it in one of three words:

| Score     | Word       |
| --------- | ---------- |
| 80 to 100 | On target  |
| 50 to 79  | Partly     |
| below 50  | Off target |

The score shows on the workout's card on the calendar, and on the planned workout's and the
activity's pages, with a line on what pulled it down, such as "Intervals pulled it down: 27% of
the time in target."

![A planned workout done partly: time and load within 20%, but little time in the target bands](/help-images/compliance.png)

## The parts

The score is the average of the parts that could be scored:

- **Time**, **Distance** and **Load**: what you did against what was planned. Anything within 20%
  of the plan scores full marks. Beyond that, the part loses marks steadily and scores nothing at
  50% over or under. Distance counts only for a workout with steps measured in distance.
- **Intervals**: the share of the time you held each step's target, for the steps that have one.
  A step's target band is its power, pace or heart rate, with 5% either side of a set value, or
  its range widened a little. Power counts over 3 seconds and speed over 10 seconds, as a bike
  computer shows them; heart rate counts as recorded.

**Step by step** lists each step with its target band, your average, and the share of the step
you were in it.

## How steps are found in the activity

When your device recorded one lap per step, each about as long as planned, as a watch or bike
computer running the workout does, TrainStack uses the laps. Otherwise it lays the steps end to end from the start of the activity,
over the time you were moving. So if you warmed up longer than planned, the steps after the
warm-up are compared with the wrong part of the ride. Running the workout on a watch or bike computer
that records a lap per step gives the truest score.

## Why a part is not scored

The planned workout's page lists each part it could not score and why:

- **Load is not scored**: the plan or the activity has no load, which needs your thresholds.
  [Set them](/help/thresholds-and-zones).
- **Intervals are not scored: the workout has no targets to hold**, or its only target is an
  all-out effort, which has no band to hold.
- **Intervals are not scored: they need the activity's analysis**, and for targets set against a
  threshold, that threshold in Settings. A new activity is analysed within a minute or two.
- When no step with a target had data, such as power targets on a ride without a power meter.
- **Time, distance and load are not scored** when a step lasts until you press lap: how long it
  takes is yours to choose.

A score marked "so far" is provisional: the activity is still being analysed.

## When the score is wrong

Most often, the wrong activity was paired. Open the planned workout and use **Unpair**, or pair
another activity from that day. See [Planning your week](/help/plan-your-week).

If your thresholds were wrong on that day, the targets and load were too: correct them from that
day in **Settings**, and the score is worked out again.
