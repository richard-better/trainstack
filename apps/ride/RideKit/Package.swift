// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "RideKit",
  platforms: [.iOS("27.0"), .macOS(.v26), .watchOS("27.0")],
  products: [
    .library(name: "RideUI", targets: ["RideUI"])
  ],
  targets: [
    .target(name: "RideBluetooth"),
    .target(name: "RideData", resources: [.copy("Resources/SampleRide.fit")]),
    .target(name: "RideLink", dependencies: ["RideData"]),
    .target(name: "RideStyle", dependencies: ["RideData"]),
    .target(
      name: "RideUI",
      dependencies: ["RideBluetooth", "RideData", "RideStyle"],
      swiftSettings: [.defaultIsolation(MainActor.self)]
    ),
    .testTarget(name: "RideBluetoothTests", dependencies: ["RideBluetooth"]),
    .testTarget(name: "RideDataTests", dependencies: ["RideData"]),
    .testTarget(name: "RideLinkTests", dependencies: ["RideLink"]),
    .testTarget(
      name: "RideUITests",
      dependencies: ["RideUI"],
      swiftSettings: [.defaultIsolation(MainActor.self)]
    ),
  ]
)
