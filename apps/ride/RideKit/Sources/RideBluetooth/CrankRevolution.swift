/// Both Cycling Power and CSC use 16-bit crank counts and event times in 1/1024 seconds.
struct CrankRevolution: Equatable, Sendable {
  let count: UInt16
  let eventTime: UInt16
}
