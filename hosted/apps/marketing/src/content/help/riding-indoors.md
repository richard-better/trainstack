---
title: Riding indoors with Ride
summary: How Ride shows and records power on a smart trainer, Power match for a separate power meter, the ramp test and calibrating your trainer.
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

## Ramp test

The ramp test estimates your FTP in about 20 minutes. Start it in Ride under Settings, then Ramp
Test. It runs like any workout, in ERG mode:

1. Five minutes of warm-up.
2. One-minute steps, each a little harder than the last. They start at half your FTP and go up by
   6% of it each minute, so the ramp lasts about the same time whatever your FTP. Without an FTP,
   Ride sizes the steps for 200 W.
3. Hold each step as long as you can at a steady cadence. The ramp ends by itself once your power
   stays under 80% of the step for ten seconds, or as soon as you stop pedalling. The player shows an
   open-ended ramp rather than a time left.
4. Five minutes of cool-down, then end and save the ride as usual.

When you save it, Ride shows the result and how it got there: your best minute of the ride, and
75% of it, which is your FTP estimate. The ramp test favours riders with a strong sprint, who can
hold a high last minute; if that is you, your FTP may be a little lower than the estimate.

Nothing changes until you decide. Set FTP keeps the estimate as a ramp test dated today and sets
your FTP from today, which updates your zones and reaches your account like any other change (see
[Thresholds and zones](/help/thresholds-and-zones)). When the test took your heart rate higher than your
maximum heart rate, Ride offers to set the new maximum; do that only if you rode yourself out.

## Calibrating your trainer

A spin-down tells the trainer how much its flywheel slows by itself, so it measures your power more
accurately. Do one after about ten minutes of riding, once the trainer is warm, and again if you
move it or change its tyre pressure.

In Ride, open Settings, then Calibrate Trainer, and press Start Spin-Down. Pedal up past the speed
shown, then stop pedalling when Ride says so and keep still while the flywheel coasts to a stop.
Ride then says whether the trainer finished; the trainer keeps the result itself.

Ride calibrates trainers that offer a spin-down over Bluetooth (FTMS). For a trainer that does not,
Ride says so: calibrate it in its maker's app.
