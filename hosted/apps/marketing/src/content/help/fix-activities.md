---
title: Fixing a wrong or duplicate activity
summary: The same workout recorded twice, files that were linked wrongly, and deleting an activity.
section: Activities
order: 11
---

## The same workout from two places

When two recordings of one workout reach TrainStack, such as Ride's file and your watch's file of
the same ride, TrainStack links them into one workout instead of counting it twice. Every file is
kept. In **Activities** the workout shows once, marked with how many sources it has, and its time, distance and load count once in your totals and fitness.

TrainStack treats two activities as the same workout when they are the same kind of sport and
overlap in time for at least half of the shorter one. Indoors or out does not matter, so Ride's
indoor ride matches a watch that called it cycling. Outdoors, their distances have to agree
roughly too.

![The Sources section of a ride with two recordings](/help-images/sources.png)

Open the activity and scroll to **Sources** to see every recording of it:

- **Primary** marks the source that gives the workout its place and numbers in your activity
  list. TrainStack prefers a session you logged by hand, then the richest file: power counts
  double, and heart rate, cadence, distance and elevation once each, then the larger file. Press **Make primary** on another source to choose it yourself. Your choice
  sticks, even when more files arrive later.
- **Not the same workout** separates a source that was linked by mistake, such as two short runs
  on the same morning. It becomes a workout of its own, and TrainStack does not link the two again unless you link them yourself.
- **Link another activity** joins one TrainStack did not link, such as a watch file whose clock
  was wrong. Choose it from the activities within a day of this one, or search by name or sport.

Each of these offers **Undo** right after you make it.

## Deleting an activity

Open the activity and press **Delete**. For an activity with one source, this deletes it and its
file. For a workout with more than one source, it deletes only the source you are looking at,
and the workout stays with the others.

A deleted activity stays deleted. If Ride, another device or you send the same file again,
TrainStack refuses it and says when you deleted it. This is so a phone that was offline cannot
bring back something you removed. There is no way to undo a delete, so download the file first from
the activity's page if you might want it.

## Wrong numbers

TrainStack reads an activity's numbers from its file, so a wrong number usually means the file
says so: a power meter that was not zeroed, a heart rate strap that lost contact, or a GPS that
drifted. A few things are worth checking first:

- _Load, zones and intensity look wrong._ They come from your thresholds on the day of the
  activity. If your FTP or heart rate thresholds were missing or wrong then, correct them in
  **Settings** from that day, and TrainStack works the activity out again within a minute or two.
  See [Thresholds and zones](/help/thresholds-and-zones).
- _The day is wrong._ An activity belongs to the day it started in its own local time when the
  file says where it was. Otherwise it uses your time zone in **Settings**.
- _No numbers at all._ The activity's page says why, such as a damaged file. The file is kept
  and you can still download it.

## Not supported yet

You cannot change an activity's name, sport or start time, crop it, or fix a power or heart rate
dropout in TrainStack. Change the file in another tool and upload it again, then delete the old
one.
