---
title: Fitness, fatigue and form
summary: What the Training page's numbers mean, how they are worked out, and why the chart might be empty.
section: Training
order: 22
---

**Training** shows how your training adds up over weeks and months, across every sport.

![Fitness, fatigue and form on the Training page](/help-images/training.png)

## The three numbers

- **Fitness** is your load averaged over about the last six weeks. It rises slowly as you train
  consistently and falls slowly when you stop.
- **Fatigue** is your load averaged over about the last week. It rises quickly after hard days
  and falls quickly when you rest.
- **Form** is fitness minus fatigue. When it is high you are rested; when it is low you are
  carrying fatigue.

Each day's load is the sum of the load of that day's activities, and an activity's load is
worked out from its power, pace or heart rate against your thresholds. See
[Reading an activity](/help/activity-analysis). Strength and bouldering sessions add load from
how hard you rated them. See [Strength and bouldering](/help/strength-and-bouldering).

Every activity counts, whatever the sport, so a hard week of runs shows up in your fitness for
cycling too. A workout recorded on two devices counts once.

## What form means

| Form         | Range         | What it means                             |
| ------------ | ------------- | ----------------------------------------- |
| Very fresh   | +20 and above | Rested, and fitness is fading             |
| Fresh        | +5 to +20     | Rested and ready for a hard day or a race |
| Neutral      | -10 to +5     | Holding steady                            |
| Productive   | -30 to -10    | Training is building fitness              |
| Overreaching | below -30     | Fatigue is high, so plan some rest        |

These are rules of thumb, not a verdict on how you feel. Your own [check-ins](/help/check-in) sit
next to them, so you can compare.

## The chart

**Show the last** picks how far back the chart goes, from 6 weeks to 3 years. The top chart has
fitness and fatigue, the middle one form with its bands, and the bottom one each day's load. Point
at a day, or use the arrow keys, to see its numbers on the right.

## Your bests

**Your bests** holds your power curve for cycling (your best average power over 5 seconds to an
hour) and your fastest running times over distances from 400 m to the marathon, each with the
day it was done, from **This season**, the **Last 6 weeks** or **All time**. Open a day to go to
that activity.

## When the chart is empty

- **No activities yet**: [get your activities in](/help/add-activities).
- **None of your activities has a load yet**: TrainStack needs your thresholds to score them.
  The page says which to set, or shows thresholds it found in your activities to accept. See
  [Thresholds and zones](/help/thresholds-and-zones).
- **One of your recent activities has no load, so it is left out of fitness and fatigue.** It
  might have no power, pace or heart rate, or be a sport whose thresholds you have not set.

## How it is calculated

Each day, fitness moves 1/42 of the way toward that day's load, and fatigue 1/7 of the way. This
is the impulse-response model of Eric Banister as Andrew Coggan's Performance Manager uses it,
the same model behind TrainingPeaks' CTL, ATL and TSB. Fitness and fatigue start from zero on your
first activity, so they read low until you have a couple of months of history in TrainStack.
