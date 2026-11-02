public enum FITError: Error, Equatable, Sendable {
  case notAFITFile
  case truncated
  case badChecksum
  case noRecords
}
