---
title: Riding indoors with Ride
summary: How Ride shows and records power on a smart trainer, and how to hold a separate power meter on target with Power match.
section: Training
order: 23
---

Ride runs your workouts on a smart trainer. In ERG mode it sets the trainer to each step's target
power, and the trainer holds it however fast you pedal. These settings are in Ride, under Settings,
then Player.

## Power display

Power readings jump around from one second to the next, even when the trainer holds the target
well. Power display chooses how the big power number in the player is worked out:

- 3-second average, the default: steady enough to read, quick enough to show a change.
- 5-second average: steadier still.
- Instant: each reading as it comes.

This changes only the number you look at, in every mode. The chart, the recorded ride, its
analysis and what reaches your account and Strava keep every reading as the power source sent it.

## Power match

If you have a power meter on the bike (in the cranks or pedals) as well as the trainer, the two
rarely agree: they measure in different places, and each has its own error. A few percent is
usual. Ride records the power meter's power, so without help a 250 W step on the trainer can be
240 W or 265 W on the meter, and your ride says you missed the target.

Power match makes the power meter read the target. Ride compares the meter and the trainer while
both are steady and asks the trainer for a little more or less, so the meter shows what the step
asks for. The player shows the correction beside your power, as Power match +4%. It is on by
default; turn it off under Settings, then Player.

What it does and does not do:

- It corrects by at most 10%. A meter further off than that needs calibrating, not matching.
- It learns over about half a minute of steady riding, then keeps what it learnt from one step to
  the next, so a new step lands on target as quickly as the trainer can get there.
- It learns nothing while you stop pedalling, coast, pause or change the target, and carries on
  where it was when you ride again.
- If the meter goes quiet, reads zero while the trainer reads power, or stops showing the cranks
  turning, Ride rides on the trainer alone after five seconds and starts learning again once the
  meter is back.
- It applies only in ERG mode, and only when the power meter is the power source. Ride picks a
  power meter over the trainer by itself; you can choose either in the player's sensor list.

Calibrate your power meter (its zero offset, in its own app) before a ride, as its maker
recommends. Power match makes the trainer agree with the meter, so the meter has to be right.
