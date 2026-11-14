---
title: Getting activities in
summary: Upload files from a watch or bike computer, or ride with Ride, and what to do when a file is refused.
section: Activities
order: 10
---

Activities reach TrainStack in two ways today.

## Upload files

On **Activities**, press **Upload files** and choose one or more files, or drag them anywhere on
the page. TrainStack takes:

- **FIT** files, which Garmin, Wahoo, COROS, Suunto, Polar, Hammerhead, Zwift and most other
  devices and apps write.
- **GPX** and **TCX** files, the older formats many apps can export.

Each file can be up to 25 MB. Most watches and bike computers let you copy the file off over USB,
and most apps have an export or download option on an activity. Garmin Connect, for example, has
"Export Original" on an activity's menu, which gives you the FIT file in a zip: unzip it first.

TrainStack reads the sport, start time, name and laps from the file. The upload list shows each
file's progress, and **Open** takes you to the activity once it is in. Uploading the same file
twice does nothing: it is already in your account.

## Ride

Rides you record with the Ride app reach TrainStack when Ride is signed in to your account with the
same Apple ID. Ride uploads its rides by itself, including the ones you rode before signing in.

## When a file is refused

| What you see                                                           | What it means and what to do                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not a FIT, GPX or TCX file.                                            | The file is something else, such as a zip. Unzip it, or export the activity again as FIT                                                                                                        |
| Too large. Activity files can be up to 25 MB.                          | 25 MB of FIT holds days of recording, so check that you chose the right file. If it is one very long activity, split it in your device's app first                                              |
| This FIT file is a planned workout, not a recorded activity.           | It is a structured workout, not something you did. Import it under **Workouts** instead: see [Workouts](/help/workouts)                                                                         |
| This GPX file has no recorded activity in it, such as a planned route. | A route or course has no times. Only files of something you did can be uploaded                                                                                                                 |
| This FIT file is damaged or incomplete.                                | The file ends early or cannot be read, often from a device that lost power. Copy it off the device again; if it is still refused, the activity cannot be recovered from it                      |
| You deleted this activity on …, so it was not added again.             | You deleted this exact file before. A deleted activity stays deleted, so a phone or a backup cannot bring it back by accident. See [Fixing a wrong or duplicate activity](/help/fix-activities) |
| Did not upload. Check your connection and try again.                   | The upload did not reach TrainStack. Press **Try again**                                                                                                                                        |

A file can also upload but not be read in full. Its activity is kept, with its file, and the
activity's page says why it has no numbers, such as **Trainstack found this file ends early**.

## The same activity from two places

If your watch and Ride both recorded the same ride, upload the watch's file anyway. TrainStack
notices they are the same workout and links them, so it is counted once. See
[Fixing a wrong or duplicate activity](/help/fix-activities).

## Not supported yet

- _Garmin Connect._ There is no Garmin connection, and Garmin does not give us one for now.
  Upload the files.
- _Strava import._ TrainStack cannot read your activities from Strava. Ride can send rides
  to Strava, but nothing comes back. Strava lets you download one activity's original file, or
  your whole history from its account settings.
- _Apple Health._ TrainStack cannot read workouts from Apple Health yet. Ride saves its rides
  to Health, but nothing comes the other way.
- _COROS, Wahoo, Suunto and Polar connections._ Upload their files.
- _Outdoor recording._ Ride does not record outdoor rides or runs on your phone or watch.
- _Editing an activity._ You cannot change an activity's name, sport or time in TrainStack. They
  come from the file.
