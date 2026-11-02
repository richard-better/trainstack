struct CrankRevolution: Equatable, Sendable {
  static let eventTimeTicksPerSecond = 1024.0

  let count: UInt16
  let eventTime: UInt16
}
