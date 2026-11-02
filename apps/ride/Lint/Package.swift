// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "RideLint",
  platforms: [.macOS(.v26)],
  products: [.executable(name: "ride-lint", targets: ["ride-lint"])],
  dependencies: [.package(url: "https://github.com/swiftlang/swift-syntax.git", exact: "604.0.0")],
  targets: [
    .target(
      name: "RideLintRules",
      dependencies: [
        .product(name: "SwiftSyntax", package: "swift-syntax"),
        .product(name: "SwiftParser", package: "swift-syntax"),
      ]
    ),
    .executableTarget(name: "ride-lint", dependencies: ["RideLintRules"]),
    .testTarget(name: "RideLintRulesTests", dependencies: ["RideLintRules"]),
  ]
)
