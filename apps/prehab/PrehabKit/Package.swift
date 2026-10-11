// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "PrehabKit",
  platforms: [.iOS("27.0"), .macOS(.v26)],
  products: [.library(name: "PrehabUI", targets: ["PrehabUI"])],
  targets: [
    .target(name: "PrehabCore"),
    .target(name: "PrehabAPI", dependencies: ["PrehabCore"]),
    .target(
      name: "PrehabUI", dependencies: ["PrehabCore", "PrehabAPI"],
      resources: [.process("Resources")], swiftSettings: [.defaultIsolation(MainActor.self)]),
    .testTarget(name: "PrehabCoreTests", dependencies: ["PrehabCore", "PrehabAPI"]),
  ]
)
