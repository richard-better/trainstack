---
title: Reading an activity
summary: What each part of an activity's page shows, from load and intensity to zones, laps, bests and the map.
section: Training
order: 21
---

Open any activity from **Activities** to see its analysis. What appears depends on what the file
recorded: a ride with a power meter shows power, a run with GPS shows a map and pace, and a file
with only heart rate shows heart rate.

![An indoor ride's analysis](/help-images/activity.png)

## The numbers at the top

Time, distance, and the average and maximum of each reading the file has: power, heart rate,
cadence, speed, or pace for runs. **Time** is the time the timer ran; when you paused, **Elapsed** shows the whole span, pauses
included.

## Effort

- **Load** is how hard the activity was, on one scale for every sport: an hour at your threshold
  scores 100. It says what it was worked out from: power against your FTP, pace against your
  threshold pace, or heart rate against your heart rate thresholds. Load feeds your
  [fitness and form](/help/fitness-and-form).
- **Intensity** is how hard it was for its length, against your threshold: 1.00 is threshold
  effort. An easy ride is around 0.6, a hard hour around 0.9 to 1.0.
- **Normalized power** is the steady power that would have cost you the same, so a ride of hard
  intervals scores above its average power. **Work** is the total energy you put through the
  pedals, in kilojoules.
- For runs, **Grade-adjusted pace** is your pace with the hills taken out: what the same effort
  would have been on the flat. **Normalized grade-adjusted pace** weights the hard parts like
  normalized power does.

If the activity has no **Load**, look at what its page says first. Most often a threshold it needs
is missing: see [Thresholds and zones](/help/thresholds-and-zones), and the activity is worked out
again within a minute or two after you set one. If the page says the file could not be analysed,
thresholds will not help: the charts are read from the file, but it has no load.

## Charts

The charts show each reading along the activity. **Chart against** switches between time and
distance. Point at a chart to read the values at that moment, and to see where you were on the
map. With the keyboard, focus the charts and use the arrow keys.

## Route

Runs and rides with GPS show their route. **Colour the route by** colours it by pace or speed,
heart rate, power or grade. Parts where GPS dropped out are left as gaps, not straight lines. An
indoor activity has no route.

## Time in zones

How long you spent in each heart rate, power and pace zone, **Using the settings that held on**
the day of the activity. If the zones look wrong, **Edit zones** takes you to them in Settings.
When a threshold is missing, this section says which one to set instead.

## Laps

Each lap the device recorded, with its time, distance and averages, and normalized power, work and
grade-adjusted pace where they apply.

## Bests

For rides with power, the power curve: your best average power over durations from 5 seconds to
an hour, in this ride and in your best rides of **This season**, the **Last 6 weeks** or
**All time**. For runs, your fastest times over standard distances from 400 m to the marathon.
Your bests across all activities are on **Training**.

## Planned

If the activity was matched with a planned workout on your calendar, **Planned** shows how
closely it followed the plan. See [Planned and done](/help/compliance).

## Sources and the file

**Sources** lists every recording of this workout, if more than one device recorded it. See
[Fixing a wrong or duplicate activity](/help/fix-activities). The download button gives you the
original file, exactly as it was uploaded.

## When something is missing

- _No charts._ The file has no power, heart rate, cadence or speed, or it could not be read.
  The page says which.
- _No map._ The file has no GPS, or the activity was indoors.
- _Numbers still changing._ A new activity is analysed within a minute or two of arriving. Until
  then some numbers are missing.
