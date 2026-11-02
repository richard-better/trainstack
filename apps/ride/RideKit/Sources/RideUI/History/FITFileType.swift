import UniformTypeIdentifiers

extension UTType {
  nonisolated static let fitFile = UTType(filenameExtension: "fit") ?? .data
}
