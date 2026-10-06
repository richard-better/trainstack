// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "RideKit",
  platforms: [.iOS(.v26), .macOS(.v26)],
  products: [
    .library(name: "RideUI", targets: ["RideUI"])
  ],
  targets: [
    .target(
      name: "RideUI",
      swiftSettings: [.defaultIsolation(MainActor.self)]
    )
  ]
)
