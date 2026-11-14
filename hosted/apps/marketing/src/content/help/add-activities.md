---
title: Getting activities in
summary: Upload files from a watch or bike computer, ride with Ride, or let Ride bring in your workouts from Apple Health, and what to do when a file is refused.
section: Activities
order: 10
---

Activities reach Trainstack in three ways today.

## Upload files

On **Activities**, press **Upload files** and choose one or more files, or drag them anywhere on
the page. Trainstack takes:

- **FIT** files, which Garmin, Wahoo, COROS, Suunto, Polar, Hammerhead, Zwift and most other
  devices and apps write.
- **GPX** and **TCX** files, the older formats many apps can export.

Each file can be up to 25 MB. Most watches and bike computers let you copy the file off over USB,
and most apps have an export or download option on an activity. Garmin Connect, for example, has
"Export Original" on an activity's menu, which gives you the FIT file in a zip: unzip it first.

Trainstack reads the sport, start time, name and laps from the file. The upload list shows each
file's progress, and **Open** takes you to the activity once it is in. Uploading the same file
twice does nothing: it is already in your account.

## Ride

Rides you record with the Ride app reach Trainstack when Ride is signed in to your account with the
same Apple ID. Ride uploads its rides by itself, including the ones you rode before signing in.

Signed in, History in Ride shows your account's activities, every sport and source, beside the
rides on that device, each once: what you upload here, import from Health, log as strength or
bouldering, or record with Ride on another device. A workout recorded twice shows as the activity
that stands for it. Ride downloads an activity's file only when you open it, to draw its charts,
laps and zones the way it draws its own rides, and keeps the files you opened lately, not your
whole history. Offline, History shows what Ride last saw, and an activity you have not opened on
that device says it needs a connection for its charts. Logged sessions show what they sum up to;
their exercises and problems are on the web. Deleting an activity in Ride deletes it from your
account, and one you delete here leaves Ride the next time it syncs. Signing out of Ride removes
your account's activities from it and keeps the rides recorded on that device.

## Apple Health

Ride on iPhone can bring every workout in Apple Health into your account: runs, rides, swims,
strength sessions and the rest, from your Apple Watch or any app that saves to Health, such as
Garmin Connect. In Ride, open Settings, then Account, and turn on Import from Health. Ride
asks Health for your workouts with their routes, heart rate, power, cadence, speed, distance and
energy, and for your sleep, resting heart rate and HRV, which readiness reads (see
[Today and readiness](/help/today-and-readiness)), and reads nothing else. Health lets you choose how far back Ride may read; to bring in
your history, allow all recorded data.

Ride then adds every workout Health holds, the ones from before too, newest first, and each new one
a few minutes after it ends, whenever Ride is open. Each becomes an activity with its sport, its
route on the map and its charts, from **Apple Health**. Ride never adds the rides it saved to Health
itself: those reach your account from Ride already. A workout of a kind Trainstack has no sport for,
such as dance or tennis, still comes in, without a sport, and counts toward your load by heart rate.

Each Health workout is one activity, however often Ride reads it and on however many of your
devices. If you delete one, it stays deleted: Ride does not bring it back.

Turning Import from Health off stops new workouts, sleep, resting heart rate and HRV coming in.
The workouts already imported stay in your account until you delete them here, and the sleep,
resting heart rate and HRV already sent stay until you delete your account. Both are in your
[account export](/help/your-data). To stop Ride reading Health altogether, also turn its
access off in the Health app, under your profile, then Apps.

## When a file is refused

| What you see                                                           | What it means and what to do                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not a FIT, GPX or TCX file.                                            | The file is something else, such as a zip. Unzip it, or export the activity again as FIT                                                                                                                                |
| Too large. Activity files can be up to 25 MB.                          | 25 MB of FIT holds days of recording, so check that you chose the right file. If it is one very long activity, split it in your device's app first                                                                      |
| This FIT file is a planned workout, not a recorded activity.           | It is a structured workout, not something you did. Import it under **Workouts** instead: see [Workouts](/help/workouts)                                                                                                 |
| This GPX file has no recorded activity in it, such as a planned route. | A route or course has no times. Only files of something you did can be uploaded                                                                                                                                         |
| This FIT file is damaged or incomplete.                                | The file ends early or cannot be read, often from a device that lost power. Copy it off the device again; if it is still refused, the activity cannot be recovered from it                                              |
| You deleted this activity on …, so it was not added again.             | You deleted this exact file before. A phone or a backup cannot bring it back by accident, but you can: press **Restore**. See [Bringing back a deleted activity](/help/fix-activities#bringing-back-a-deleted-activity) |
| Did not upload. Check your connection and try again.                   | The upload did not reach Trainstack. Press **Try again**                                                                                                                                                                |

A file can also upload but not be read in full. Its activity is kept, with its file, and the
activity's page says why it has no numbers, such as **Trainstack found this file ends early**.

## The same activity from two places

If your watch and Ride both recorded the same ride, upload the watch's file anyway. Trainstack
notices they are the same workout and links them, so it is counted once. The same goes for a Garmin
ride that reached Apple Health and whose file you also uploaded. See
[Fixing a wrong or duplicate activity](/help/fix-activities).

## Not supported yet

- _Garmin Connect._ There is no Garmin connection, and Garmin does not give us one for now.
  Upload the files.
- _Strava import._ Trainstack cannot read your activities from Strava. Ride can send rides
  to Strava, but nothing comes back. Strava lets you download one activity's original file, or
  your whole history from its account settings.
- _Apple Health in the background._ Ride imports Health workouts while it is open, not while it
  is closed.
- _COROS, Wahoo, Suunto and Polar connections._ Upload their files.
- _Outdoor recording._ Ride does not record outdoor rides or runs on your phone or watch.
- _Editing an activity._ You cannot change an activity's name, sport or time in Trainstack. They
  come from the file.
