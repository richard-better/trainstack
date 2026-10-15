# TrainStack Ride alpha

Ride is an indoor cycling app for iPhone, iPad, Mac and Apple Watch. You pick a structured
workout, Ride sets your smart trainer's resistance for every interval, and it saves the ride as a
standard `.fit` file. This is an early alpha: it has only been tested on a Mac with a Zwift Ride
and a Polar H10, so please tell us what breaks.

## What you need

- iPhone or iPad on iOS 27, or a Mac on macOS 26. An Apple Watch on watchOS 27 is optional and
  supplies heart rate.
- A smart trainer that supports Bluetooth FTMS (Wahoo KICKR, Tacx Neo, Elite, Saris and most
  others). A trainer that only sends power and cadence still works, but Ride cannot control it.
- Optional: a Bluetooth heart rate strap, power meter or cadence sensor.

## What works

- Pairing a trainer, heart rate strap, power meter and cadence sensor, and choosing which one
  supplies power or cadence. Paired devices reconnect on their own.
- 11 built-in workouts, written against your FTP, with Today suggesting some that fit the time you
  have. Filter by zone, length and stress.
- ERG mode (the trainer holds each interval's power), Slope mode and Level mode, with a nudge
  control for a day that feels too hard or easy.
- The ride screen with the workout chart, live power, cadence and heart rate, pause and skip.
  The screen stays awake, and the ride keeps going with the app in the background.
- If the trainer disconnects, the ride pauses and Ride reconnects. You resume when ready.
- Heart rate from an Apple Watch, with the watch showing the current interval.
- Rides saved to History as `.fit` files, with zones, a power curve and a breakdown. You can
  import, share and export `.fit` files, or send a ride to Strava with Send to Strava (sign in
  with Apple under Settings, Account, then connect Strava). A ride interrupted by a crash or quit can be resumed or
  saved when you reopen the app.
- Power, heart rate and pace zones, FTP tests and your training load on Progress.
- Rides saved to Apple Health as indoor cycling workouts, with power, cadence, heart rate and
  energy. On a Mac, which has no Health, the ride reaches Health through your iPhone once it
  syncs. Ride skips a ride Health already has a cycling workout for.
- Rides synced between your devices through iCloud, when they are signed in to the same Apple
  Account.

## What does not work yet

- You cannot build your own workouts or import `.zwo` and `.mrc` files.
- Strava is the only place Ride can send a ride. Anywhere else, export the `.fit` file and upload it yourself.
- Settings stay on the device, and so do rides without iCloud: deleting the app then deletes
  them. Deleting a ride on one device deletes it on the others too. A TrainStack account exists
  only to hold your Strava connection, and Ride works without one.
- No training plans.

## Try this first

Ride has been used for real rides from start to finish, including sending them to Strava, but
only on a Mac with a Zwift Ride and a Polar H10, and with little of what goes wrong mid ride. A 30
minute ride that covers these is the most useful thing you can do:

1. Start a workout in ERG mode and lock your phone partway through. Does the trainer still follow
   the intervals when you unlock it?
2. Turn the trainer off for a few seconds. Does the ride pause, and does it reconnect and resume?
3. Force quit the app mid ride and reopen it. Is the ride offered back?
4. Finish the ride and send it to Strava, or export the `.fit` file and open it in Garmin Connect
   or TrainingPeaks. Do the power, heart rate and time look right for your setup?
5. Check the ride in the Fitness or Health app. Is it there once, with its power and heart rate?
   After a ride on a Mac, open Ride on your iPhone and check again.

## Reporting a problem

Open a [Ride bug report](https://github.com/richard-better/trainstack/issues/new?template=ride-bug.yml)
and say what you were doing, what you expected and what happened. The most useful details are your
trainer and sensor models, the device and OS version, and the `.fit` file of the ride if there is
one. Anything that looks wrong in a ride's numbers is worth reporting.
