# TrainStack Thesis

https://trainstackhq.com/

## Where we are going

Serious amateur athletes split their training across many apps. Strava records and
shares. TrainingPeaks and Runna plan. Whoop and Garmin track recovery. Zwift and
TrainerDay run indoor sessions. Each sees only part of the athlete. The plan does not know
you slept four hours, the recovery app does not know you have a race in six weeks, and
neither knows what is in your calendar.

Training is one system, so it should live in one place. TrainStack is the whole training
stack in a single app:

- **Track** workouts across sports: cycling, running, swimming, strength training, and
  bouldering, which the major trackers ignore despite its popularity.
- **Plan** with training plans generated from your goals and event dates, calibrated by
  your history, and kept up to date as life happens.
- **Recover** with sleep and daily wearable data feeding load and recovery, in the same
  place your training is planned.
- **Schedule** training around your existing calendar events, synced back as real time
  slots for both history and future sessions.
- **Share** workouts with friends, with summaries worth posting.
- **Coach** through coach access to your data, coach-made plans that AI tailors to each
  athlete, and tooling for clubs.

TrainStack is open source. You own your data, the community can extend it with new sports
and training load models, and anyone can self-host it.

## Where we start: TrainStack Ride

We start with indoor cycling: an open source alternative to the likes of TrainerRoad and
TrainerDay.

Zwift's 3D world loses its appeal after the first few rides. What indoor riders actually
need is simple: a structured workout, a trainer that holds the right resistance, and a
clean recording at the end. TrainStack Ride does exactly that:

1. Shows the workout as a graph of planned intervals, with live progress through it.
2. Connects to your smart trainer and heart rate sensor over Bluetooth.
3. Sets trainer resistance automatically (ERG mode) to hit each interval's power target.
4. Records power, cadence, heart rate, and speed for the whole session.
5. Saves the ride as a standard `.fit` file and uploads it to Strava and other services.

Ride is useful on its own from day one, and every session produces the structured workout
data that tracking, planning, and recovery are built on.
