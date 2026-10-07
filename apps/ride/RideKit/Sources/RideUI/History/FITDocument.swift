import SwiftUI
import UniformTypeIdentifiers

/// A FIT file as it was opened, for exporting unchanged.
nonisolated struct FITDocument: FileDocument {
  static let readableContentTypes = [UTType.fitFile]
  let data: Data

  init(data: Data) { self.data = data }

  init(configuration: ReadConfiguration) throws {
    data = configuration.file.regularFileContents ?? Data()
  }

  func fileWrapper(configuration: WriteConfiguration) -> FileWrapper {
    FileWrapper(regularFileWithContents: data)
  }
}
