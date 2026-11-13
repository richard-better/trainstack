import SwiftSyntax

public struct CoreImportsNoDevices: Rule {
  public static let name = "core-imports-no-devices"

  static let allowedImports: [String: Set<String>] = [
    "RideData": ["Foundation"],
    "RideCore": ["Foundation", "RideData"],
  ]

  public func check(_ file: LintedFile) -> [Violation] {
    guard
      let (module, allowed) = Self.allowedImports.first(where: {
        file.isInside(directory: $0.key)
      })
    else { return [] }
    return file.tree.descendants(ImportDeclSyntax.self)
      .filter { !allowed.contains($0.path.first?.name.text ?? "") }
      .map {
        file.violation(
          self, at: $0,
          "\(module) sees only readings and commands, and stays free of devices and Apple frameworks. Import only \(allowed.sorted().joined(separator: ", ")), and adapt \($0.path.trimmedDescription) in the layer above."
        )
      }
  }
}
