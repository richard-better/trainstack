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
  and analyses it (zones, power curve) with no UI dependency. `RideBluetooth` finds nearby
  devices, and pairs and reconnects the rider's own. `RideUI` has a folder per feature
  (`App`, `Today`, `Workouts`, `Player`, `History`, `Progress`, `Settings`, `Devices`,
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
`keychain-stays-in-its-store` (#44) and `deterministic-core`. When you fix a bug or a review
finding that a rule could have caught, add the rule in the same change: a `Rule` in
`Lint/Sources/RideLintRules`, listed in `RideLint.rules`, with tests in
`Lint/Tests/RideLintRulesTests`.

## Deterministic rides and replay

`RideCore` runs a ride as a pure function of its inputs. `RideEngine` takes each `RideInput`
(a tick with the second's reading and whether the trainer is connected, or a rider's control)
and moves the `RideSession` on. `RideController` only gathers inputs from the clock, sensors and
rider, and acts on the engine's output. The `deterministic-core` rule bans clocks and
randomness in `RideCore`, so the same inputs always give the same ride.

`RideJournal` writes the header and every input as JSON lines while a ride is on. Recovering a
crashed ride replays the journal. A finished ride's journal is kept as a trace in
`Application Support/Ride traces`, the latest `RideJournal.tracesKept` of them, named by start
time and the ID of the ride it saved. To reproduce a ride from the field, get its trace with Share
Ride Trace in the ride's More menu, put it in `RideKit/Tests/RideCoreTests/Traces`, record its golden FIT with
`RIDE_RECORD_TRACES=1 swift test --package-path apps/ride/RideKit --filter RideTraceReplayTests`,
and write a test that replays it to the behaviour you expect. `RideTraceReplayTests` replays
every trace there and compares it with its golden FIT, so any change to how a ride is recorded
shows up as a diff.

Every ride also records its Bluetooth traffic beside the journal (`BluetoothLog`), and the log
is kept and shared with the trace as `<trace>.bluetooth.jsonl`. `BluetoothDevices` records
through a `RecordingTransport` around the real transport: the state of each connected device
when the ride starts (its connection, trainer ranges and readiness, its battery, and its
measurement packets from the last `RecordingTransport.measurementHistory` seconds, enough to
rebuild crank cadence), then every packet as raw bytes, every trainer target and command, each
power or cadence source the rider picks, and each ride tick.
Devices are numbered, and names and identifiers stay out. `BluetoothReplay` feeds a log through
a fresh `BluetoothDevices` on the recorded clock and gives the readings at each tick and the
trainer commands it sends. `RideTraceReplayTests` checks that every log in `Traces` replays to
the power and cadence its trace recorded and to the commands the trainer was sent.
`RideBluetoothLogTests` writes the `trainer-and-strap` log with `RIDE_RECORD_TRACES=1`.

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
