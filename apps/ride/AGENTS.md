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
  `Shared` for what several use, with one type per file. `RideWatchUI` is the watch app,
  `RideLink` what the phone and watch send each other, `RideStrava` the TrainStack account (Sign in with Apple)
  and sending rides to Strava through the hosted API, which holds Strava's tokens (see
  `docs/deployment.md`), and `RideStyle` the zone colours both
  apps share.

The watch runs a HealthKit workout session mirrored to the iPhone: it sends heart rate, and
the phone sends back a `RideGlance` each second. The iPhone passes watch heart rate on as a
standard Bluetooth heart rate sensor (`HeartRateRelay`) with a Ride service beside it. Ride
on the Mac connects to that service during a ride (`WatchRelayReceiver`) without pairing. A
paired chest strap (`BluetoothDevices`) wins over the watch while it keeps reporting.

On iPhone and iPad, `HealthRides` saves each ride Ride records to Health from its recording,
and the phone tells the watch (`LinkMessage.rideRecorded`) to discard its workout so Health
has one. Without a watch, the phone runs the workout session itself (`PhoneWorkout`).
`RideSync` syncs the library through the rider's private CloudKit database with
`CKSyncEngine`, one record per ride named by its file's SHA-256. The Mac has no Health, so an
iPhone saves the Mac's rides as they sync, and the Mac tells a relaying iPhone it records the
ride so the watch discards its workout then too.

While a ride is on, `KeepAwake` stops the screen locking (and App Nap on the Mac). The
`bluetooth-central` background mode keeps the trainer connected with the app in the background,
and iOS stops timers there, so the trainer's measurements also move `RideController` on. If a
paired trainer disconnects mid ride the ride pauses, and the rider resumes it once the trainer is
back.

`Ride/` is a folder-synchronized group, so adding or removing files there does not touch
`project.pbxproj`. Edit the project file only for target-level changes (capabilities,
build settings, new targets), and prefer making those in Xcode.

## Build and test

Requires Xcode 27.

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

## Conventions

- Swift 6 language mode with strict concurrency.
- State uses Observation (`@Observable`). UI modules default to `MainActor` isolation.
- Tests use Swift Testing and live in the package, so they run with `swift test`.
- Bluetooth: the macOS sandbox grants it with `ENABLE_RESOURCE_ACCESS_BLUETOOTH`, and
  `NSBluetoothAlwaysUsageDescription` is set through `INFOPLIST_KEY_` build settings.
