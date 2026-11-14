---
title: Thresholds and zones
summary: Set FTP, threshold pace and heart rate, choose zones per sport, and what TrainStack's suggestions mean.
section: Training
order: 20
---

Your thresholds are what TrainStack measures every activity against. Without them it can still
show an activity's power, pace and heart rate, but not its load, intensity or time in zones, so it
is left out of your [fitness chart](/help/fitness-and-form). Logged strength and bouldering
sessions are the exception: their load comes from how hard you rate them. They live in **Settings**, under
**Thresholds and zones**.

## The thresholds

| Threshold                              | What it is                                                                             | Used for                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| FTP                                    | Functional threshold power: the power you could hold for about an hour                 | Power zones and the load of anything with power |
| Threshold pace                         | The pace you could hold for about an hour. For swimming it is your critical swim speed | Pace zones and the load of runs                 |
| Lactate threshold heart rate           | Your average over the last 20 minutes of an all-out 30-minute effort                   | Heart rate zones and load from heart rate       |
| Max heart rate                         | The highest your heart rate reaches in an all-out effort                               | Heart rate zones                                |
| Resting heart rate                     | Measured lying down, just after you wake up                                            | Load from heart rate                            |
| Aerobic threshold, power or heart rate | Your first lactate or ventilatory threshold (LT1 or VT1), usually from a lab test      | Zone models that use it                         |

To set one, press **Set** or **Change** beside it, enter the value and the day it holds **From**,
and press **Save**. The badge **Sets your zones** marks the thresholds your chosen zone model is
drawn from.

Load needs one of these per activity: FTP for anything with power; threshold pace for runs; or
resting, max and lactate threshold heart rate together for anything with heart rate. Runs use
pace first, then power, then heart rate. Every other sport uses power, then heart rate.

## Thresholds change over time

Every change has a day, and each activity is measured against the thresholds that held on its
day. So when you raise your FTP from today, last month's rides keep the FTP they were ridden at,
and their load does not change.

If a threshold was wrong in the past, set the right value **From** the day it became true, or use
**Correct** on the entry under **History**, and TrainStack works out every activity since then
again within a minute or two. **Remove** takes an entry out of the history. Activities before
your first threshold, zone or sport setting use your earliest settings; weight follows the same
rule on its own.

## Sports and their own zones

**Default** holds the zones every sport uses. Use **Add a sport** to give a sport its own
settings, for example running, then:

- **Pace** zones always belong to a sport, so set threshold pace on the sport.
- For heart rate and power, a sport uses your **Default** zones until you turn off its
  "Use Default heart rate zones" or "Use Default power zones" switch, for example because your
  heart rate runs higher when you run than when you ride. Then it keeps its own thresholds and
  zones.

The sport's "Remove" button, such as "Remove running", takes its own settings away.

## Zone models

Under **Zones**, **Zone model** chooses how zones are drawn from your thresholds:

- Heart rate: Joe Friel's for cycling and for running and Andy Coggan's, from lactate threshold
  heart rate; percent of max, from max heart rate; Karvonen, from max and resting heart rate; and
  Stephen Seiler's three zones, from your aerobic and lactate thresholds.
- Power: Coggan's, and a polarized model, from FTP; Seiler's, from aerobic threshold power and FTP.
- Pace: Friel's running pace zones from threshold pace, and swimming zones from critical swim
  speed.

The table shows each zone's range.

To use your own boundaries, change where a zone ends: the next zone starts from it. Changing a
threshold works every zone out again, unless they are your own.

## Suggestions from your activities

![A suggested max heart rate in Settings](/help-images/threshold-suggestion.png)

TrainStack looks at your activities of the last 180 days and suggests a threshold when its
estimate differs enough from what you have, or when you have none. It never changes a threshold
by itself. A suggestion names the effort it comes from (open it to see the activity) and how sure
it is.

- **Use from today** sets the threshold from today. Older activities keep the settings they had,
  so if you had no FTP before, older rides still have none. Only when it is your first threshold,
  zone or sport setting of any kind (weight does not count) do older activities take it too,
  because activities before your first such setting use your earliest settings. To measure
  older activities with it, use the button below.
- **Use from** a day, when the effort was earlier, sets it from the day of the effort, so the
  activities since then are measured with it too.
- **Dismiss** hides it. The same effort will not suggest it again, but a new effort can.

How each one is estimated:

- **FTP** from your best power over 20 minutes (95% of it), checked against your best 5, 10 and
  20 minutes together, and raised to your best hour when you held more.
- **Threshold pace** from your best run efforts of 10 minutes to 2 hours, predicting the distance
  you could run in an hour. Treadmill runs do not count.
- **Lactate threshold heart rate** from a hard, steady 30 minutes ridden or run at about your
  threshold: your average heart rate over its last 20 minutes.
- **Max heart rate** from the highest heart rate you held for a few seconds. It only ever goes up,
  because your real max is at least the highest you have seen.

An effort that was clearly not all-out does not count, and older efforts count for a little less.
Each suggestion says how sure it is:

- "Your efforts agree and look all-out." Two efforts agree, and your heart rate shows they were
  hard.
- "The effort looks all-out." One good effort, or efforts that are a few weeks old.
- "A rough estimate: Trainstack cannot tell whether the effort was all-out." Often because your
  max heart rate is not set, so heart rate cannot show how hard an effort was. A rough estimate
  never lowers a threshold.
- For max heart rate: "It is the highest your heart rate held, so your max is at least this."

Suggestions come from hard efforts, so if you never ride or run hard, they stay low or do not
come at all. A test, such as a 20-minute all-out effort, gives the clearest one.

## Weight and time zone

**Weight** is used for power to weight. **Time zone** decides where your days end: what today is,
and which day an activity belongs to when its file does not say where it was.
