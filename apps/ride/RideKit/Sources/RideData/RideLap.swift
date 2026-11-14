import Foundation

public struct RideLap: Equatable, Sendable {
  public var start: TimeInterval
  public var duration: TimeInterval
  public var trigger: LapTrigger
  public var stepIndex: Int?
  public var distanceMetres: Double?
  public var averagePower: Int?
  public var maxPower: Int?
  public var averageHeartRate: Int?
  public var maxHeartRate: Int?
  public var averageCadence: Int?

  public init(
    start: TimeInterval, duration: TimeInterval, trigger: LapTrigger, stepIndex: Int? = nil,
    distanceMetres: Double? = nil, averagePower: Int? = nil, maxPower: Int? = nil,
    averageHeartRate: Int? = nil, maxHeartRate: Int? = nil, averageCadence: Int? = nil
  ) {
    self.start = start
    self.duration = duration
    self.trigger = trigger
    self.stepIndex = stepIndex
    self.distanceMetres = distanceMetres
    self.averagePower = averagePower
    self.maxPower = maxPower
    self.averageHeartRate = averageHeartRate
    self.maxHeartRate = maxHeartRate
    self.averageCadence = averageCadence
  }

  public init(
    from start: TimeInterval, to end: TimeInterval, trigger: LapTrigger, stepIndex: Int?,
    samples: [RideRecording.Sample]
  ) {
    let first = Self.firstSample(after: start, in: samples)
    let inside = samples[first..<Self.firstSample(after: end, in: samples)]
    let distanceBefore = first > 0 ? samples[first - 1].distanceMetres ?? 0 : 0
    let powers = inside.compactMap(\.power)
    let heartRates = inside.compactMap(\.heartRate)
    self.init(
      start: start, duration: end - start, trigger: trigger, stepIndex: stepIndex,
      distanceMetres: inside.last?.distanceMetres.map { $0 - distanceBefore },
      averagePower: Self.average(powers), maxPower: powers.max(),
      averageHeartRate: Self.average(heartRates), maxHeartRate: heartRates.max(),
      averageCadence: Self.average(inside.compactMap(\.cadence)))
  }

  public var end: TimeInterval { start + duration }

  private static func firstSample(
    after elapsed: TimeInterval, in samples: [RideRecording.Sample]
  ) -> Int {
    var low = 0
    var high = samples.count
    while low < high {
      let middle = (low + high) / 2
      if samples[middle].elapsed <= elapsed { low = middle + 1 } else { high = middle }
    }
    return low
  }

  private static func average(_ values: [Int]) -> Int? {
    values.isEmpty ? nil : Int((Double(values.reduce(0, +)) / Double(values.count)).rounded())
  }
}
