---
title: Privacy and your data
summary: Who sees your data, how to download all of it, and how to delete your account.
section: Account
order: 50
---

## Who can see your data

Only you. TrainStack has no profiles, followers, feeds or coaches yet, so nothing you upload,
log or plan is shown to anyone else. The exceptions are ones you turn on yourself:

- The [calendar feed](/help/calendar-feed), which anyone with its address can read.
- Strava, if you connect it in Ride: Ride sends the rides you choose to Strava, and Strava's own
  privacy settings apply there.

There is no privacy policy or terms of service yet. Until there are, do not rely on TrainStack
for anything you cannot afford to lose, and download your data now and then.

## Downloading everything

In **Settings**, under **Your data**, press **Download** next to **Export your data**. You get one
archive, `trainstack-export-<day>.tar`, with:

- The original file of every activity, exactly as it arrived.
- Your activities, settings with their history, workouts, lists, planned workouts, check-ins,
  logged sessions and account, as JSON, with a `README.md` that explains every file.

It is built as it downloads, so a large account takes a while. If the download breaks, start it
again. macOS and Windows open `.tar` files themselves.

Nothing imports this archive back into TrainStack yet. It is for keeping, and for taking your data
elsewhere: every activity file opens in any app that reads FIT, GPX or TCX.

## Deleting your account

In **Settings**, press **Delete account…**. TrainStack lists what goes:

- Every activity, with its original file, statistics and laps.
- Your weight, thresholds and zones, with their history.
- Your workouts and workout lists.
- Your Strava connection. Strava is told TrainStack no longer has access.
- Your Sign in with Apple link, and every device signed in.

It happens at once and cannot be undone, so download your data first. If you have not signed in
in the last day, TrainStack asks you to **Sign in again** first, to be sure it is you.

Activities already on Strava stay there, and Ride keeps the rides on your devices and in iCloud.
If you sign in again later, you start a new, empty account, and Ride fills it with the rides still
on your devices.

## Questions

Open an issue on [GitHub](https://github.com/richard-better/trainstack/issues/new), or send
feedback from Ride's settings.
