# TrainStack Ride

Native SwiftUI app for iOS and iPadOS 27+ and macOS 26+, with a watchOS 27+ companion. It connects to smart trainers and
sensors over Bluetooth, runs structured workouts, and records rides. See
[`docs/THESIS.md`](../../docs/THESIS.md) for the product scope.

## Layout

- `Ride.xcodeproj` and `Ride/` - a thin app target: the `@main` entry point, assets,
  signing, entitlements, and Info.plist keys. Keep code out of it. `RideWatch/` is the same
  for the Apple Watch app, which the iOS app embeds.
- `RideKit/` - a local Swift package where the app's code lives, one module per concern.
  The app links the `RideUI` product. `RideData` decodes FIT files into a `RideRecording`
  and analyses it (zones, power curve) with no UI dependency, holding and pausing records by
  the same rule as `@trainstack/analysis` on the server (`SamplingRule`), so the app and the web
  give a ride the same numbers. `packages/analysis/test/swift-parity.test.ts` checks this. `RideBluetooth` finds nearby
  devices, and pairs and reconnects the rider's own. `RideUI` has a folder per feature
  (`App`, `Today`, `Calendar`, `Workouts`, `Player`, `History`, `Progress`, `Settings`, `Devices`,
  `Health`, `Sync`) and
  `Shared` for what several use, with one type per file. `RideCore` runs a ride as a pure
  function of its inputs, and records and replays them (see below). `RideWatchUI` is the watch app,
  `RideLink` what the phone and watch send each other, `RideStrava` the TrainStack account (Sign in with Apple)
  and sending rides to Strava through the hosted API, which holds Strava's tokens (see
  `docs/deployment.md`), and `RideStyle` the zone colours both
  apps share.

The watch runs a HealthKit workout session mirrored to the iPhone: it sends heart rate, and
the phone sends back a `RideGlance` each second. The iPhone passes watch heart rate on as a
standard Bluetooth heart rate sensor (`HeartRateRelay`) with a Ride service beside it. Ride
on the Mac connects to that service during a ride (`WatchRelayReceiver`) without pairing. It
scans for the Ride service by UUID, because an iPhone in the background advertises its services
only to scans that name them. A paired chest strap (`BluetoothDevices`) wins over the watch
while it keeps reporting.

On iPhone and iPad, `HealthRides` saves each ride Ride records to Health from its recording,
and the phone tells the watch (`LinkMessage.rideRecorded`) to discard its workout so Health
has one. Discarding keeps the samples the workout collected, so the watch also stops collecting
active energy then. The phone resends that claim with every glance, and with every heart rate
while it relays a ride the Mac records. The watch never saves a workout the phone started, since
the phone saves its own recording, and it ends one itself once the phone has been quiet for five
minutes (`WatchWorkout`). A workout the rider started on the watch is saved by the watch unless
it is claimed. Without a watch, the phone runs the workout session itself (`PhoneWorkout`).
A ride waits in a saved queue until Health can take it (locked, or access not asked yet), and is
skipped when Health already has a cycling workout over its time, from Ride or any other app. A
ride joins the queue before its file is written, so a crash between the two cannot leave it out.
`RideSync` syncs the library through the rider's private CloudKit database with
`CKSyncEngine`, one record per ride named by its file's SHA-256. A ride's file never changes, so
its record is only added or deleted, and a conflict on one is ignored. The library on the device
stays the source of truth: a device that has not synced yet, or has just signed in, sends every
ride. Deleting a ride leaves a `DeletedRide` record, which every device remembers, so a device that
has not synced since cannot send the ride back: once it hears of the deletion it drops the ride,
and a device that knows deletes the record again if a stale one sends it. Importing a deleted
ride's file again keeps it on that device only. One more record holds the secret behind
`RideClaim`; the first device to send it wins and
the others adopt it. The Mac has no Health, so an
iPhone saves the Mac's rides as they sync, and the Mac tells a relaying iPhone it records the
ride so the watch discards its workout then too.

Signed in to a TrainStack account, `ActivitySync` also sends the library to the hosted API's
activities (`docs/deployment.md`), beside iCloud, which stays for riders without an account. An
activity is named by the same SHA-256. Each pass sends the deletions it owes, lists the
account's activities, and uploads every ride the account does not have, so it survives being
offline, relaunches and failures (it retries with backoff, and again when the app becomes
active). It hears of rides and deletions from iCloud too (`RideLibrary.onChange`), so a ride
deleted through either reaches the other. When the server answers that a ride was deleted
(`410`), or a ride the account had is gone from it, the device drops the ride with
`RideLibrary.remove`, which also leaves an iCloud `DeletedRide`, and a deleted ride imported
again stays on that device. State is kept per account (`Application Support/ActivitySync`), and
every request is bound to the session it started with, so signing out stops uploads and one
account's deletions never reach another. A ride removed while signed out is deleted from the
account this device last signed in to, when it signs in again.

Rider settings (thresholds, zone models, a sport's own zones, weight and FTP tests) are kept
as a `SettingsLedger`, the same registers the settings API keeps (`docs/deployment.md`): one
per setting and day, holding the change or its removal and `updatedAt`, the moment the athlete
made the edit, to the millisecond. `ZoneHistory`, the FTP tests and the weight are derived from
it, so it is the one source of truth on the device, and what this app cannot show (a sport it
does not know) is kept as it came. Changes for a sport it does not know still apply to the
profile as the server applies them (`ZoneProfile.apply(unknownSport:)`), so they end the earliest
settings on the same day on both, and the app and the server give an old activity the same
zones. An edit is stamped with the device's clock, and
always after the value it replaced, so an edit made on a device whose clock is behind still
beats what that device saw. Settings are not in iCloud: without an account they stay on the
device, as before. Signed in, `SettingsSync` reads the account's history after its cursor,
takes each register whose stamp is not older than the device's, then sends every unsent one,
up to 100 a request, and takes the answer, which holds what won, so a stale edit learns the
winner. It passes like `ActivitySync` (`SyncPasses`), after every edit, and when the app
becomes active. A setting the server refuses stays on this device and is not sent again until
the next launch.

The ledger belongs to the first account it syncs with (`SettingsLedger.account`), so the first
sign-in merges the device's settings into whatever the account has, and edits made while
signed out go to that account when it signs in again. Signing in to another account keeps
this ledger in `Application Support/SettingsSync` and switches to that account's, so one
athlete's settings never reach another's account. Deleting the account leaves the settings on
the device, unclaimed, for the next account. Settings saved before the ledger are brought over
stamped at the Unix epoch, so any real edit, from any device or the web, wins over them; a
weight other than the default goes on the day of the first zone history entry.

Signed in, `WorkoutSync` keeps a copy of the athlete's TrainStack workouts and lists on the
device (`AccountWorkouts`, one file per account in `Application Support/WorkoutSync`), so the
Workouts screens show them beside the bundled workouts, offline too. Each pass (`SyncPasses`,
after every edit, when the app becomes active and when the Workouts screen appears) sends the
deletions and built-in copies the device owes, then reads `workouts/changes` and
`workout-lists/changes` after their cursors. The server's copy wins: it settles conflicts by the
later `updatedAt`. A workout keeps the server's JSON as it came, so one this version cannot read
is shown as needing a newer Ride rather than lost. Ride does not edit workouts: it saves a copy of
a built-in under an id it chooses (`builtin-workouts/{id}/copy`, so a replayed copy changes
nothing) and deletes the athlete's own, which stays deleted: the device remembers it and ignores
any later write of it, as the server refuses them. Signing out hides the workouts and keeps the
file; another account sees only its own; deleting the account removes its file. A ride copies the
workout when it starts, so a change or deletion on the web during the ride does not reach it.

Signed in, `CalendarSync` keeps the athlete's training calendar on the device (`AccountCalendar`, one
file per account in `Application Support/CalendarSync`): the weeks from four weeks before today to four
weeks after (`CalendarWindow`) as `calendar.range` returns them, with each day's planned workouts,
activities, pairings, compliance and the week totals, so Today and the calendar read it offline. The
range is the source of what is on screen, because the server works out state, pairing and compliance as
it reads and an arriving activity bumps no revision. Each pass (`SyncPasses`) reads
`planned-workouts/changes` after its cursor, which is small, and reads the range again when that shows a
change, when the screen asks (the app becomes active, Today or the calendar appears, a ride uploads),
when the day has changed, every 15 minutes, and at each check while an analysis is due. A check runs
each minute while the app runs, so a change on the web, or an analysis finishing, shows up within a
minute. Today is the athlete's
day, by the time zone in their settings (UTC until they set one), read with the range, so it moves on at
the athlete's midnight offline and does not move when the device travels; a workout before today that
was neither done nor skipped then reads missed, as the server would say. Account rules follow
`WorkoutSync`: signing out hides the calendar and keeps the file, another account sees only its own, and
deleting the account removes its file.

The Calendar tab shows those weeks as the web calendar does: a column per day on a wide screen and a
list of days on a phone, each week with its time, distance and load done against planned. A planned
workout reads planned (dashed), done (solid, with the activity it was matched with or that the athlete
paired, and its compliance score and why), skipped (dotted, struck through, with the reason) or missed
(amber), and an activity no planned workout claims reads unplanned. `ComplianceWords` says why in the
web's words (`hosted/apps/account/src/lib/compliance.ts`), so the two read the same.

From the app the athlete can skip a planned workout (with a reason) or take the skip back, move it to
another day, and unpair a wrong match; creating and editing planned workouts stays on the web. Each
edit is a `PlannedWrite` stamped when the athlete makes it, after every earlier edit on the device
(the latest stamp is kept in the file), kept in the account's file, shown at once
over the range read from the server, and sent in order at the start of the next pass; the server's answer to each replaces the stored copy, so
an accepted edit stays even if the next read fails. The server
keeps each part's last edit by that stamp, so an edit made offline still loses to a later one from the
web, and the next range read shows who won. An edit to a planned workout deleted since is dropped,
since a delete is final, and one the server's clock says comes from the future waits.

A ride started from a planned workout pairs with it, because the athlete's intent is certain there.
`RideLauncher` remembers the planned workout and the account it was planned in (`PlannedRide`), and
when the ride is saved `AccountCalendar.rode` queues a pairing of that planned workout with the ride's
activity (its file's SHA-256) in that account's file, signed in or not, stamped when the ride ended. `CalendarSync` sends it with `plannedWorkouts.pair` once
`ActivitySync` has uploaded the ride; until then the server answers `ACTIVITY_NOT_FOUND` and it waits.
If the planned workout was moved to another day meanwhile (`NOT_PAIRABLE`), the app moves it back to
the ride's day (in the athlete's time zone, by which the server dates a ride whose file carries no
local time, as Ride's did before they wrote one) with the same stamp and pairs again: a move made on the web during the ride is older
than the ride's end and loses, and one made after the ride stands, leaving the ride unplanned. A
pairing still waiting after 30 days is dropped. A ride recovered after a crash does not know its
planned workout, and pairs by the server's own rule.

Apple asks apps with Sign in with Apple to revoke the user's tokens when the account is deleted,
so the server needs a refresh token Ride's own sign-in got. After every native sign-in Ride sends
the credential's authorization code to `account/apple-authorization` (it lasts five minutes and
works once), without waiting and without failing the sign-in if it is refused. Delete Account
first asks Apple for a fresh credential and sends its code, which covers accounts created before
Ride sent one; if the athlete cancels Apple's sheet the account is still deleted, as the
confirmation says. The web sign-in (the Homebrew build) needs neither.

HealthKit and iCloud can launch the app in the background with no window, so `RideApp.init`
calls `WatchSupport.activateAtLaunch()` and `SyncSupport.activateAtLaunch()`.

The Mac proves it is the rider's with a `RideClaim`: it signs the iPhone's one-time challenge with a random secret that reaches only the
rider's devices, through the same private CloudKit database, so no other Mac in range can claim
the ride.

`ConnectWithStravaButton` stands in for the "Connect with Strava" artwork Strava's brand
guidelines ask for. Swap the artwork in before Strava reviews the app.

While a ride is on, `KeepAwake` stops the screen locking (and App Nap on the Mac). The
`bluetooth-central` background mode keeps the trainer connected with the app in the background,
and iOS stops timers there, so the trainer's measurements also move `RideController` on. If a
paired trainer disconnects mid ride the ride pauses, and the rider resumes it once the trainer is
back.

The player runs a `PlannedWorkout`: a bundled `WorkoutTemplate` becomes one (`planned`), and so
does a workout from the athlete's TrainStack library. That arrives in the model of
`@trainstack/workout` as `TrainStackWorkout`, and `rideability` is the one place that maps it to
what the player runs, or to the reason it cannot be ridden. It expands repeats as the package's
`flatten` does, placing each repeat's cues on the step they fall in; `tests/ride-workouts.test.mjs`
holds the steps Ride plays for `Tests/RideDataTests/Workouts/workouts.json` (recorded in
`played.json` with `RIDE_RECORD_WORKOUTS=1`) to `flatten`. Everything a trainer can do plays as
written: power as a share of FTP or in watts, constant, ranged (ERG holds the middle of the range)
or ramped (ERG follows the ramp each second), cadence, cues and nested repeats. A step without a
target is a free ride and a max effort is all out; in ERG mode the trainer gets a flat road for
both, as it does once a workout ends. A heart rate target is shown for the rider to hold, also on a
flat road. Ride refuses, and says why: another sport, pace targets (a trainer holds power, not
pace), steps or cues measured in distance (Ride has no speed model to time them by), a ramp on a
lap-button step or a repeat cue across one (neither has a length to work from), and, by name, any kind of step, target or
level this version does not know, so a newer model never crashes it or plays silently changed.
It also refuses what would crash the player rather than play: a target no rider or trainer can
hold (`TargetLevel.most…`), a range whose low end is above its high end, a step longer than a day
(`PlannedStep.longest`) and more than `TrainStackWorkout.mostSteps` steps once repeats are counted out. A ride's
trace keeps the `PlannedWorkout` it started with, so a workout edited or deleted on the web during
a ride does not change the ride. Traces written before kept a `template`, and still read.

A lap-button step (`UntilLap`) lasts until the rider presses lap, the same control and journalled
input (`skipInterval`) that skips a timed step, so a replay ends it where the ride did. It never
ends on time, distance or its expected length; the player holds its target meanwhile and counts the
step up, showing the expected length only as a hint. `RideSession` therefore keeps the current
interval as an index rather than deriving it from the position: a timed step ends when the
position reaches its end, a lap-button step when the rider laps, and the timeline is laid out again
then (a lapped step keeps the length ridden, the current one grows, and later ones are drawn at
their expected length). A cue on a lap-button step shows only if the rider reaches it before
lapping. While lap-button steps remain, the time left is the known part, said as such.

Every workout interval is a lap, and the rider can mark one at any moment (`markLap`, the player's
Lap button, ⌘L), which splits the interval or, on a lap-button step, ends it. `RideSession` keeps
the laps as marks in ride time, so a pause adds nothing to one and a recovered ride rebuilds them
by replaying its journal. Each is written as a FIT lap message with its totals over the records
inside it, `lap_trigger` (manual, time, or session end for the last) and `wkt_step_index`, the
step of the workout it rode (none once the workout is over). The server places a workout's steps
by laps only when there is one lap per step, so a lap the rider marks inside an interval makes it
place them by time, which matches the laps for a workout ridden as planned. The ride's page in
History lists the laps.

Each ride's file also carries its local time (`local_timestamp` on the activity message), from the
device's UTC offset when the ride started, kept in the trace header so a replay writes the same
file.

A cue shows over the chart for its shown-for time (`PlannedCue.defaultShownFor` when it has none),
large enough to read from the bike, and ten seconds before a timed step ends the player announces
the next step by its name, target and length the same way (`PlayerBanner`), also to VoiceOver. The
glance carries a cue short enough for the watch (`RideGlance.longestCue`). The bundled workouts'
text is `WorkoutTemplate.cues`, placed by step beside their steps in `WorkoutTemplate.library`, so
the server's built-ins, generated from that source (`packages/workout/README.md`), carry the same
text, and `tests/ride-library-source.test.mjs` fails if either drifts.

The rider can change the workout as it plays, each change a journalled input: add a minute to the
current timed interval (`extendInterval`, also how the cool-down is lengthened), skip it
(`skipInterval`), or go back (`previousInterval`), which ends the current interval where it is and
rides the step before it again, then this one, from their starts. `RideSession` keeps these as a
timeline of planned steps, each `Interval` naming its `stepIndex` in the workout, so the
`PlannedWorkout` in the trace stays as planned and the laps say which step each stretch rode.
Once the workout ends the ride carries on recording as a free ride, in whichever mode the rider
picks (ERG holds a flat road, as for any step without a target), until they end it; that stretch
is a lap with no step.

Speed and distance come from power through `VirtualBike`, as in Zwift and TrainerRoad: many
trainers report no speed, and in ERG mode what they report follows the gear, not the effort.
Workouts are labelled with the fixed `PowerZone` bands, since their steps are shares of FTP
rather than a rider's own zones. `ZoneModel`'s tables follow Friel's "Quick guide to setting
zones", Coggan's "Training and Racing with a Power Meter", and the usual critical swim speed
bands.

CoreBluetooth cancels a connection whose `CBPeripheral` nothing holds, so the transports keep
every peripheral they connect to. Turning Bluetooth off ends every connection without a callback
for each, invalidates the peripherals, and removes a peripheral manager's services, so each
transport drops that state then and rebuilds it once Bluetooth is back.

`Ride/` is a folder-synchronized group, so adding or removing files there does not touch
`project.pbxproj`. Edit the project file only for target-level changes (capabilities,
build settings, new targets), and prefer making those in Xcode.

## Build and test

Requires Xcode 27.

When workout handoff, library sync, Health saving, or trainer pause behaviour changes,
use [verify-ride-protocols](../../.agents/skills/verify-ride-protocols/SKILL.md) and run
`apps/ride/Specs/check.sh` (Java 17+). CI checks these TLA+ models with TLC.

```sh
# Package only: fast, no simulator
swift build --package-path apps/ride/RideKit

# App, both platforms
xcodebuild build -project apps/ride/Ride.xcodeproj -scheme Ride \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO
xcodebuild build -project apps/ride/Ride.xcodeproj -scheme Ride \
  -destination 'platform=macOS,arch=arm64' CODE_SIGNING_ALLOWED=NO
```

The iOS build also builds the watch app. To try the watch alone, run the `RideWatch` scheme
on a watch simulator.

Builds with `CODE_SIGNING_ALLOWED=NO` carry no entitlements at all: no HealthKit, iCloud, Sign
in with Apple or (on the Mac) App Sandbox. They are for checking that the app builds: on iOS,
CloudKit stops an app without its entitlement as it launches, so run simulator builds signed.
To keep the entitlements:

- Without overrides, the project signs automatically with the team in `DEVELOPMENT_TEAM`. That
  needs an Xcode account in that team, and keeps every entitlement on every platform.
- For the iOS and watch simulators, sign ad hoc
  (`CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=`). That keeps HealthKit,
  iCloud and Sign in with Apple, though iCloud only syncs in a build signed with the team.
- On the Mac, ad hoc alone fails with `"Ride" requires a provisioning profile`, because Sign in
  with Apple needs one. Add `CODE_SIGN_ENTITLEMENTS=` to drop it: the app keeps the sandbox,
  Bluetooth, network and file entitlements, but cannot sign in to TrainStack or sync rides.
- The Mac keeps the TrainStack session in the data protection keychain, which needs the
  application identifier a provisioning profile gives. Builds without one start signed out.

Debug builds take launch arguments to try the app without hardware:

- `-ride "<workout name>"` opens straight into that ride (needs an FTP).
- `-simulated-trainer` rides with a pretend trainer, and `-sample-devices` shows pretend
  Bluetooth devices, since the simulator has none.
- `-sample-rides` uses a sample profile, the sample ride in History and a pretend trainer.
- `-trainstack-server <url> -trainstack-session <token>` signs in to that API with that session
  token, kept in memory, to try account features such as Send Feedback against a local API
  Worker. Get a token by signing in through the API, as `tests/helpers/apple.mjs` does.
- On the watch, `-ride "<workout name>"` plays a ride as if the phone ran it,
  `-ride-minutes <minutes>` starts that far in, and `-always-on` shows the wrist-down screen.

Format with `swift format --in-place --recursive apps/ride/Ride apps/ride/RideKit`.
CI runs `swift format lint --strict`.

## Lint rules

`apps/ride/Lint` is `ride-lint`, a swift-syntax linter CI runs on every Swift file:

```sh
cd apps/ride && swift run --package-path Lint ride-lint Ride RideWatch RideKit Lint
```

Comments are banned (`no-comments`). If code needs explaining, give it a better name or a type,
or pin the behaviour with a test whose name says it. Only `// swift-tools-version:` and
`// swift-format-ignore` directives are allowed, and there is no way to switch a rule off.
Knowledge that no code can carry, such as why an architecture is the way it is, goes in this
file.

Each other rule comes from a bug or review finding, so the same mistake cannot come back:
`one-type-per-file`, `entry-holds-no-closure` (#41), `no-geometry-reader` (#21),
`keychain-stays-in-its-store` (#44), `deterministic-core` and `core-imports-no-devices`. When you fix a bug or a review
finding that a rule could have caught, add the rule in the same change: a `Rule` in
`Lint/Sources/RideLintRules`, listed in `RideLint.rules`, with tests in
`Lint/Tests/RideLintRulesTests`.

## Deterministic rides and replay

`RideCore` runs a ride as a pure function of its inputs. `RideEngine` takes each `RideInput`
(a tick with the second's reading and whether the trainer is connected, or a rider's control)
and moves the `RideSession` on. `RideController` only gathers inputs from the clock, sensors and
rider, and acts on the engine's output. The `deterministic-core` rule bans clocks and
randomness in `RideCore`, so the same inputs always give the same ride.

`RideCore` sees only readings and commands, never devices. Readings come in as `TrainerReading`
and the engine asks for its `TrainerCommand`; `RideController` turns that into
`RideBluetooth`'s `TrainerTarget`. `RideCore` depends on `RideData` alone, CI tests the package
with `--explicit-target-dependency-import-check error`, and the `core-imports-no-devices` rule
keeps `RideCore` to Foundation and `RideData`, and `RideData` to Foundation, so both stay free of
devices and Apple frameworks.

`RideJournal` writes the header and every input as JSON lines while a ride is on. Recovering a
crashed ride replays the journal. A finished ride's journal is kept as a trace in
`Application Support/Ride traces`, the latest `RideJournal.tracesKept` of them, named by start
time and the ID of the ride it saved. To reproduce a ride from the field, get its trace with Share
Ride Trace in the ride's More menu, put it in `RideKit/Tests/RideCoreTests/Traces`, record its golden FIT with
`RIDE_RECORD_TRACES=1 swift test --package-path apps/ride/RideKit --filter RideTraceReplayTests`,
and write a test that replays it to the behaviour you expect. `RideTraceReplayTests` replays
every trace there and compares it with its golden FIT, so any change to how a ride is recorded
shows up as a diff.

Every ride also records its Bluetooth traffic beside the journal (`BluetoothLog`). `RideJournal`
keeps every file beside it with the trace, as `<trace>.<file>`, so the log is kept and shared
with the trace as `<trace>.bluetooth.jsonl`. `BluetoothDevices` records
through a `RecordingTransport` around the real transport: the state of each connected device
when the ride starts (its connection, trainer ranges and readiness, its battery, and its
measurement packets from the last `RecordingTransport.measurementHistory` seconds, enough to
rebuild crank cadence), then every packet as raw bytes, every trainer target and command, each
power or cadence source the rider picks, and each ride tick.
Devices are numbered, and names and identifiers stay out. `BluetoothReplay` feeds a log through
a fresh `BluetoothDevices` on the recorded clock and gives the readings at each tick and the
trainer commands it sends. `RideBluetoothLogTests`, in `RideUITests` because it needs both
`RideCore` and `RideBluetooth`, checks that every log in `Traces` replays to the power and
cadence its trace recorded and to the commands the trainer was sent, and writes the
`trainer-and-strap` log with `RIDE_RECORD_TRACES=1`.

Some things a log cannot replay. Commands are compared from the ride's first target, assuming
the trainer was not under control when the ride started, as it is once the previous ride has
let it go. Heart rate from the watch never passes through `BluetoothDevices`, so the trace's
heart rate is not compared. A heart rate source the rider picks during the ride is not
recorded.

## Simulated riders

`SimulatedRider` rides like a person with a critical power and W′, spending W′ above critical
power and recovering it below (Skiba's W′ balance). It cracks in an interval when W′ runs out.
`HeadlessRide` rides a workout with one, from the first second to the last, with scripted events
such as the trainer dropping out or the rider changing mode. Tests use them to:

- ride every workout in the library end to end, through the engine and the FIT encoder
  (`HeadlessRideTests`);
- hold each workout to a target share of a population of riders set to their FTP
  (`WorkoutDifficultyTests`): every rider finishes recovery, endurance, tempo and threshold
  workouts, at least 60% finish VO2 max ones, and all-out ones break riders only in their
  hardest efforts. When you add or change a workout, these tell you whether it is as hard as
  its category says.

## Conventions

- Swift 6 language mode with strict concurrency.
- State uses Observation (`@Observable`). UI modules default to `MainActor` isolation.
- Tests use Swift Testing and live in the package, so they run with `swift test`.
- On a sidebar, Settings replaces the app's tabs, which rebuilds them, so what the rider chose
  on a page (`TodayState`, `WorkoutsState`) lives in `RootView`, not in the page.
- Bluetooth: the macOS sandbox grants it with `ENABLE_RESOURCE_ACCESS_BLUETOOTH`, and
  `NSBluetoothAlwaysUsageDescription` is set through `INFOPLIST_KEY_` build settings.
