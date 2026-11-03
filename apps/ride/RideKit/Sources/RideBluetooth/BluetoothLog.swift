import Foundation

@MainActor
public final class BluetoothLog {
  nonisolated public static let fileName = "bluetooth.jsonl"

  private var handle: FileHandle?
  private let encoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .deferredToDate
    encoder.outputFormatting = .sortedKeys
    return encoder
  }()

  public init?(directory: URL, resuming: Bool = false) {
    let url = directory.appending(path: Self.fileName)
    let files = FileManager.default
    do {
      try files.createDirectory(at: directory, withIntermediateDirectories: true)
      let carriesOn = resuming && files.fileExists(atPath: url.path)
      if !carriesOn { files.createFile(atPath: url.path, contents: nil) }
      let handle = try FileHandle(forWritingTo: url)
      if carriesOn {
        try handle.seekToEnd()
        try handle.write(contentsOf: Data("\n".utf8))
      }
      self.handle = handle
    } catch {
      return nil
    }
  }

  isolated deinit { try? handle?.close() }

  public func close() {
    try? handle?.close()
    handle = nil
  }

  func write(_ header: BluetoothLogHeader) { writeLine(header) }

  func write(_ entry: BluetoothLogEntry) { writeLine(entry) }

  private func writeLine(_ line: some Encodable) {
    guard let handle else { return }
    do {
      try handle.write(contentsOf: encoder.encode(line) + Data("\n".utf8))
    } catch {
      close()
    }
  }
}
