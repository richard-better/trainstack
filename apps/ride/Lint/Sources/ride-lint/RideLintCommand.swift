import Foundation
import RideLintRules

@main
enum RideLintCommand {
  static func main() throws {
    let roots = CommandLine.arguments.dropFirst()
    guard !roots.isEmpty else {
      FileHandle.standardError.write(Data("usage: ride-lint <file or folder>...\n".utf8))
      exit(2)
    }
    let violations = try roots.flatMap(swiftFiles).sorted().flatMap { path in
      RideLint.lint(path: path, source: try String(contentsOfFile: path, encoding: .utf8))
    }
    for violation in violations { print(violation) }
    if !violations.isEmpty {
      FileHandle.standardError.write(Data("\(violations.count) lint violations\n".utf8))
      exit(1)
    }
  }

  static let skippedFolders: Set<String> = [".build", ".swiftpm", "DerivedData"]

  static func swiftFiles(under root: String) throws -> [String] {
    var isFolder: ObjCBool = false
    guard FileManager.default.fileExists(atPath: root, isDirectory: &isFolder) else {
      throw CocoaError(.fileNoSuchFile, userInfo: [NSFilePathErrorKey: root])
    }
    guard isFolder.boolValue else { return [root] }
    let base = root.hasSuffix("/") ? String(root.dropLast()) : root
    let enumerator = FileManager.default.enumerator(atPath: base)
    var files: [String] = []
    while let relative = enumerator?.nextObject() as? String {
      let name = (relative as NSString).lastPathComponent
      if skippedFolders.contains(name) {
        enumerator?.skipDescendants()
      } else if relative.hasSuffix(".swift") {
        files.append("\(base)/\(relative)")
      }
    }
    return files
  }
}
