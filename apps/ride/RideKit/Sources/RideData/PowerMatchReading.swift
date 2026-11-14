public struct PowerMatchReading: Equatable, Codable, Sendable {
  public var meter: Int?
  public var trainer: Int?

  public init(meter: Int?, trainer: Int?) {
    self.meter = meter
    self.trainer = trainer
  }
}
