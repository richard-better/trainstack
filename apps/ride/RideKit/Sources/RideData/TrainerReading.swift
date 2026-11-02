public struct TrainerReading: Equatable, Codable, Sendable {
  public var power: Int?
  public var cadence: Int?
  public var heartRate: Int?
  public var heartRateSource: HeartRateSource?

  public init(
    power: Int? = nil, cadence: Int? = nil, heartRate: Int? = nil,
    heartRateSource: HeartRateSource? = nil
  ) {
    self.power = power
    self.cadence = cadence
    self.heartRate = heartRate
    self.heartRateSource = heartRateSource
  }
}
