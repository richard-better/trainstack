# TrainStack Ride

Native SwiftUI app for iOS and iPadOS 27+ and macOS 26+. It connects to smart trainers and
sensors over Bluetooth, runs structured workouts, and records rides. See
[`docs/THESIS.md`](../../docs/THESIS.md) for the product scope.

## Layout

- `Ride.xcodeproj` and `Ride/` - a thin app target: the `@main` entry point, assets,
  signing, entitlements, and Info.plist keys. Keep code out of it.
- `RideKit/` - a local Swift package where the app's code lives, one module per concern.
  The app links the `RideUI` product. `RideData` decodes FIT files into a `RideRecording`
  and analyses it (zones, power curve) with no UI dependency.

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

Format with `swift format --in-place --recursive apps/ride/Ride apps/ride/RideKit`.
CI runs `swift format lint --strict`.

## Conventions

- Swift 6 language mode with strict concurrency.
- State uses Observation (`@Observable`). UI modules default to `MainActor` isolation.
- Tests use Swift Testing and live in the package, so they run with `swift test`.
- Bluetooth: the macOS sandbox grants it with `ENABLE_RESOURCE_ACCESS_BLUETOOTH`, and
  `NSBluetoothAlwaysUsageDescription` is set through `INFOPLIST_KEY_` build settings.
