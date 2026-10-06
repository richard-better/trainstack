import Foundation

/// A finished ride: the second-by-second samples and the summary of the whole session.
public struct RideRecording: Equatable, Sendable {
  public var startDate: Date
  public var workoutName: String?
  public var samples: [Sample]
  public var summary: Summary

  public init(
    startDate: Date, workoutName: String? = nil, samples: [Sample], summary: Summary
  ) {
    self.startDate = startDate
    self.workoutName = workoutName
    self.samples = samples
    self.summary = summary
  }

  public struct Sample: Equatable, Sendable {
    /// Seconds since the start of the ride.
    public var elapsed: TimeInterval
    public var power: Int?
    public var heartRate: Int?
    public var cadence: Int?
    /// Metres per second.
    public var speed: Double?
    /// Metres since the start of the ride.
    public var distance: Double?

    public init(
      elapsed: TimeInterval, power: Int? = nil, heartRate: Int? = nil, cadence: Int? = nil,
      speed: Double? = nil, distance: Double? = nil
    ) {
      self.elapsed = elapsed
      self.power = power
      self.heartRate = heartRate
      self.cadence = cadence
      self.speed = speed
      self.distance = distance
    }
  }

  public struct Summary: Equatable, Sendable {
    public var duration: TimeInterval
    /// Metres.
    public var distance: Double?
    public var averagePower: Int?
    public var maxPower: Int?
    public var averageHeartRate: Int?
    public var maxHeartRate: Int?

    public init(
      duration: TimeInterval, distance: Double? = nil, averagePower: Int? = nil,
      maxPower: Int? = nil, averageHeartRate: Int? = nil, maxHeartRate: Int? = nil
    ) {
      self.duration = duration
      self.distance = distance
      self.averagePower = averagePower
      self.maxPower = maxPower
      self.averageHeartRate = averageHeartRate
      self.maxHeartRate = maxHeartRate
    }
  }

  public var hasPower: Bool { samples.contains { $0.power != nil } }
  public var hasHeartRate: Bool { samples.contains { $0.heartRate != nil } }
}
