---
title: Workouts
summary: Build, import and export structured workouts, keep them in lists, and ride or run them.
section: Plan
order: 32
---

**Workouts** holds your workout library, TrainStack's **Built-in** workouts, and your **Lists**.

## Your library

Search by name, description or tag, and filter by sport, focus (the zone a workout trains, such as
threshold or VO2 max) and duration. Each workout shows its time and load, worked out from your
current thresholds.

To start from a built-in workout, open it and press **Copy and edit**: the copy is yours to change.
Built-in workouts themselves cannot be changed.

## Building a workout

Press **New workout**. A workout has a name, a sport (cycling, running or swimming), and steps:

- Each step lasts a time, a distance, or until you press the lap button.
- Its target is power, pace or heart rate: a set value, a range, or a ramp from one to another,
  either as a share of your threshold (such as 95% FTP) or in watts, pace or beats per minute. A
  step can also have no target, or be an all-out effort.
- Steps can have a cadence, a name, notes, and cues: text shown at a moment into the step.

**Add step** and **Add repeat** add to the end. To repeat steps you already have, select them and
press **Make a repeat**. Repeats can hold repeats.

On a wide screen you can edit the chart directly: click a bar to edit its step, drag its top to
change the target and its right edge to change its length, or use the arrow keys.

The editor shows **Unsaved changes** until you save. If you edited the same workout on another
device in the meantime, it asks which edit to keep: **Keep mine** or **Take theirs**.

A workout as a share of threshold adapts to you: when your FTP goes up, its watts go up with it.
Its profile and load use your thresholds today.

## Importing workouts

Press **Import files**, or drop files on the page. TrainStack reads:

| File   | From                                                                 |
| ------ | -------------------------------------------------------------------- |
| `.zwo` | Zwift workouts, for bike and run                                     |
| `.erg` | Power in watts, from TrainerRoad, Golden Cheetah and others          |
| `.mrc` | Power as a percentage of FTP, from the same apps                     |
| `.fit` | Workouts from Garmin Connect, TrainingPeaks, Wahoo and other devices |

Each file can be up to 1 MB. Before you add it, TrainStack shows the workout and lists anything
it changed or left out, under "Trainstack will change or leave out". Press **Add to my workouts**
to keep it.

If a file is refused, it says **What is wrong**. A FIT file of something you did, rather than a
workout to do, belongs with your activities instead: press **Upload it with your activities**. See
[Getting activities in](/help/add-activities).

## Exporting workouts

Open a workout and use **Export**:

- **.zwo**, **.erg** or **.mrc** for Zwift, TrainerRoad, Wahoo SYSTM and other apps.
- **.fit** for a Garmin, Wahoo or COROS device: copy it to the device's workouts folder, or import
  it in the device's app.

Not every format can hold everything. `.erg` and `.mrc` hold only timed power targets, so a
workout with pace or heart rate targets, or distance steps, cannot be written to them. Where a
target or step has to change to fit, such as a ramp written as small steady steps in a FIT file,
TrainStack tells you what it changed or left out before you download.

## Lists

Lists keep workouts in an order of your own, such as a block of training. Press **New list**,
then **Add to list** on a workout. Drag a workout by its handle to reorder it, or focus the handle
and use the arrow keys. Removing a workout from a list keeps it in your library.

## Riding a workout

- _On the calendar_: plan it on a day. See [Planning your week](/help/plan-your-week).
- _In Ride_: when Ride is signed in to your account, it has your library and your calendar.
  Start a planned workout from Ride's Today, and the ride pairs with it when it is done. Ride
  controls a smart trainer for power targets.
- _On a watch or bike computer_: export it as `.fit`.

## Not supported yet

- Workouts cannot be sent to Garmin, Wahoo or COROS devices directly. Export the `.fit` file.
- No workout reaches the Apple Watch as a guided run yet.
- There is no shared workout library or marketplace.
