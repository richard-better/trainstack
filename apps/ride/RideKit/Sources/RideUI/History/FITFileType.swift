import UniformTypeIdentifiers

extension UTType {
  /// FIT has no system type, so match on the file extension.
  nonisolated static let fitFile = UTType(filenameExtension: "fit") ?? .data
}
