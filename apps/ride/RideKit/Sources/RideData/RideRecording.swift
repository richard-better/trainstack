import Foundation

public struct RideRecording: Equatable, Sendable {
  public var startDate: Date
  public var workoutName: String?
  public var sport: Sport?
  public var samples: [Sample]
  public var pauses: [Range<TimeInterval>]
  public var summary: Summary

  public init(
    startDate: Date, workoutName: String? = nil, sport: Sport? = nil, samples: [Sample],
    pauses: [Range<TimeInterval>] = [], summary: Summary
  ) {
    self.startDate = startDate
    self.workoutName = workoutName
    self.sport = sport
    self.samples = samples
    self.pauses = pauses
    self.summary = summary
  }

  public struct Sample: Equatable, Identifiable, Sendable {
    public var elapsed: TimeInterval
    public var power: Int?
    public var targetPower: Int?
    public var heartRate: Int?
    public var cadence: Int?
    public var speedMetresPerSecond: Double?
    public var distanceMetres: Double?
    public init(
      elapsed: TimeInterval, power: Int? = nil, targetPower: Int? = nil, heartRate: Int? = nil,
      cadence: Int? = nil, speedMetresPerSecond: Double? = nil, distanceMetres: Double? = nil
    ) {
      self.elapsed = elapsed
      self.power = power
      self.targetPower = targetPower
      self.heartRate = heartRate
      self.cadence = cadence
      self.speedMetresPerSecond = speedMetresPerSecond
      self.distanceMetres = distanceMetres
    }
  }

  public struct Summary: Equatable, Sendable {
    public var duration: TimeInterval
    public var distanceMetres: Double?
    public var averagePower: Int?
    public var maxPower: Int?
    public var averageHeartRate: Int?
    public var maxHeartRate: Int?

    public init(
      duration: TimeInterval, distanceMetres: Double? = nil, averagePower: Int? = nil,
      maxPower: Int? = nil, averageHeartRate: Int? = nil, maxHeartRate: Int? = nil
    ) {
      self.duration = duration
      self.distanceMetres = distanceMetres
      self.averagePower = averagePower
      self.maxPower = maxPower
      self.averageHeartRate = averageHeartRate
      self.maxHeartRate = maxHeartRate
    }
  }

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
  public var hasSpeed: Bool { samples.contains { $0.speedMetresPerSecond != nil } }

  var hasPowerWhileRunning: Bool {
    samples.contains { $0.power != nil && !SamplingRule.isPaused($0.elapsed, by: pauses) }
  }

  var heldIntervals: [HeldInterval] { SamplingRule.heldIntervals(of: samples, pauses: pauses) }
}

extension RideRecording.Sample {
  public var id: TimeInterval { elapsed }
}
