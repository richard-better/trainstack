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
  (`App`, `Today`, `Workouts`, `Player`, `History`, `Progress`, `Settings`, `Devices`) and
  `Shared` for what several use, with one type per file. `RideWatchUI` is the watch app,
  `RideLink` what the phone and watch send each other, and `RideStyle` the zone colours both
  apps share.

The watch runs a HealthKit workout session mirrored to the iPhone: it sends heart rate, and
the phone sends back a `RideGlance` each second. The iPhone passes watch heart rate on as a
standard Bluetooth heart rate sensor (`HeartRateRelay`) with a Ride service beside it. Ride
on the Mac connects to that service during a ride (`WatchRelayReceiver`) without pairing. A
paired chest strap (`HeartRateSensor`) wins over the watch while it keeps reporting.

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
on a watch simulator. Builds with `CODE_SIGNING_ALLOWED=NO` lose the HealthKit entitlement, so
sign ad hoc instead (`CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=`). Debug
builds take `-ride "<workout name>"` (and `-ride-minutes`, `-always-on` on the watch) to play
a simulated ride without hardware or a paired phone.

Format with `swift format --in-place --recursive apps/ride/Ride apps/ride/RideKit`.
CI runs `swift format lint --strict`.

## Conventions

- Swift 6 language mode with strict concurrency.
- State uses Observation (`@Observable`). UI modules default to `MainActor` isolation.
- Tests use Swift Testing and live in the package, so they run with `swift test`.
- Bluetooth: the macOS sandbox grants it with `ENABLE_RESOURCE_ACCESS_BLUETOOTH`, and
  `NSBluetoothAlwaysUsageDescription` is set through `INFOPLIST_KEY_` build settings.
