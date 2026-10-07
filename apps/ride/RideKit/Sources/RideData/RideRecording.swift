import Foundation

/// A finished ride: the second-by-second samples and the summary of the whole session.
public struct RideRecording: Equatable, Sendable {
  public var startDate: Date
  public var workoutName: String?
  /// Nil when the file does not say, or names a sport Ride keeps no zones for.
  public var sport: Sport?
  public var samples: [Sample]
  public var summary: Summary

  public init(
    startDate: Date, workoutName: String? = nil, sport: Sport? = nil, samples: [Sample],
    summary: Summary
  ) {
    self.startDate = startDate
    self.workoutName = workoutName
    self.sport = sport
    self.samples = samples
    self.summary = summary
  }

  public struct Sample: Equatable, Identifiable, Sendable {
    /// Seconds since the start of the ride.
    public var elapsed: TimeInterval
    public var power: Int?
    /// The power the trainer was set to hold, in ERG mode. Nil when the ride had no target.
    public var targetPower: Int?
    public var heartRate: Int?
    public var cadence: Int?
    /// Metres per second.
    public var speed: Double?
    /// Metres since the start of the ride.
    public var distance: Double?

    public init(
      elapsed: TimeInterval, power: Int? = nil, targetPower: Int? = nil, heartRate: Int? = nil,
      cadence: Int? = nil, speed: Double? = nil, distance: Double? = nil
    ) {
      self.elapsed = elapsed
      self.power = power
      self.targetPower = targetPower
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

  /// A name for the exported `.fit` file. The workout name comes from the file, so anything that
  /// could move the path out of its directory is replaced.
  public var exportFileName: String {
    let date = startDate.formatted(.iso8601.year().month().day())
    let forbidden = CharacterSet(charactersIn: "/\\:").union(.controlCharacters)
    let title = (workoutName ?? "Ride")
      .components(separatedBy: forbidden).joined(separator: "-")
      .trimmingCharacters(in: CharacterSet(charactersIn: ".").union(.whitespaces))
    return "\(title.isEmpty ? "Ride" : title) \(date).fit"
  }

  public var hasPower: Bool { samples.contains { $0.power != nil } }
  public var hasTarget: Bool { samples.contains { $0.targetPower != nil } }
  public var hasHeartRate: Bool { samples.contains { $0.heartRate != nil } }
  public var hasSpeed: Bool { samples.contains { $0.speed != nil } }
}

extension RideRecording.Sample {
  /// Unique within a recording, which has at most one sample per moment.
  public var id: TimeInterval { elapsed }
}
