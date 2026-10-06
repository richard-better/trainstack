// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "RideKit",
  platforms: [.iOS(.v26), .macOS(.v26)],
  products: [
    .library(name: "RideUI", targets: ["RideUI"])
  ],
  targets: [
    .target(name: "RideBluetooth"),
    .target(name: "RideData", resources: [.copy("Resources/SampleRide.fit")]),
    .target(
      name: "RideUI",
      dependencies: ["RideBluetooth", "RideData"],
      swiftSettings: [.defaultIsolation(MainActor.self)]
    ),
    .testTarget(name: "RideBluetoothTests", dependencies: ["RideBluetooth"]),
    .testTarget(name: "RideDataTests", dependencies: ["RideData"]),
  ]
)
