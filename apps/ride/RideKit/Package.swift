// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "RideKit",
  platforms: [.iOS("27.0"), .macOS(.v26), .watchOS("27.0")],
  products: [
    .library(name: "RideUI", targets: ["RideUI"]),
    .library(name: "RideWatchUI", targets: ["RideWatchUI"]),
  ],
  targets: [
    .target(name: "RideBluetooth"),
    .target(name: "RideCore", dependencies: ["RideBluetooth", "RideData"]),
    .target(name: "RideData", resources: [.copy("Resources/SampleRide.fit")]),
    .target(name: "RideLink", dependencies: ["RideData"]),
    .target(name: "RideStrava"),
    .target(name: "RideStyle", dependencies: ["RideData"]),
    .target(
      name: "RideUI",
      dependencies: [
        "RideBluetooth", "RideCore", "RideData", "RideLink", "RideStrava", "RideStyle",
      ],
      swiftSettings: [.defaultIsolation(MainActor.self)]
    ),
    .target(
      name: "RideWatchUI",
      dependencies: ["RideData", "RideLink", "RideStyle"],
      swiftSettings: [.defaultIsolation(MainActor.self)]
    ),
    .testTarget(name: "RideBluetoothTests", dependencies: ["RideBluetooth"]),
    .testTarget(name: "RideCoreTests", dependencies: ["RideCore"], exclude: ["Traces"]),
    .testTarget(name: "RideDataTests", dependencies: ["RideData"]),
    .testTarget(name: "RideLinkTests", dependencies: ["RideLink"]),
    .testTarget(name: "RideStravaTests", dependencies: ["RideStrava"]),
    .testTarget(name: "RideStyleTests", dependencies: ["RideStyle", "RideData"]),
    .testTarget(
      name: "RideWatchUITests",
      dependencies: ["RideWatchUI", "RideLink"],
      swiftSettings: [.defaultIsolation(MainActor.self)]
    ),
    .testTarget(
      name: "RideUITests",
      dependencies: ["RideUI", "RideCore", "RideLink", "RideStrava"],
      swiftSettings: [.defaultIsolation(MainActor.self)]
    ),
  ]
)
