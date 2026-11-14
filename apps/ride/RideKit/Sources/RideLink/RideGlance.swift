import Foundation
import RideData

public struct RideGlance: Codable, Equatable, Sendable {
  public struct Interval: Codable, Equatable, Sendable {
    public var index: Int
    public var zone: PowerZone?
    public var numberInZone: Int?
    public var countInZone: Int?
    public var targetPower: Int?
    public var label: String?
    public var remaining: TimeInterval
    public var duration: TimeInterval

    public init(
      index: Int, zone: PowerZone?, numberInZone: Int? = nil, countInZone: Int? = nil,
      targetPower: Int? = nil, label: String? = nil, remaining: TimeInterval,
      duration: TimeInterval
    ) {
      self.index = index
      self.zone = zone
      self.numberInZone = numberInZone
      self.countInZone = countInZone
      self.targetPower = targetPower
      self.label = label
      self.remaining = remaining
      self.duration = duration
    }

    public var title: String {
      let name = label ?? zone?.name ?? RideGlance.freeRideTitle
      guard let numberInZone, let countInZone else { return name }
      return "\(name) \(numberInZone)/\(countInZone)"
    }

    public var progress: Double {
      duration > 0 ? min(max(1 - remaining / duration, 0), 1) : 1
    }
  }

  public struct NextInterval: Codable, Equatable, Sendable {
    public var zone: PowerZone?
    public var targetPower: Int?
    public var label: String?

    public init(zone: PowerZone?, targetPower: Int? = nil, label: String? = nil) {
      self.zone = zone
      self.targetPower = targetPower
      self.label = label
    }

    public var title: String { label ?? zone?.name ?? RideGlance.freeRideTitle }
  }

  public struct HeartRateZone: Codable, Equatable, Sendable {
    public var label: String
    public var index: Int
    public var zoneCount: Int

    public init(label: String, index: Int, zoneCount: Int) {
      self.label = label
      self.index = index
      self.zoneCount = zoneCount
    }
  }

  public var workoutName: String
  public var interval: Interval?
  public var next: NextInterval?
  public var mode: TrainerMode
  public var isPaused: Bool
  public var power: Int?
  public var heartRate: Int?
  public var heartRateSource: HeartRateSource?
  public var heartRateZone: HeartRateZone?

  public init(
    workoutName: String, interval: Interval? = nil, next: NextInterval? = nil,
    mode: TrainerMode = .erg,
    isPaused: Bool = false, power: Int? = nil, heartRate: Int? = nil,
    heartRateSource: HeartRateSource? = nil, heartRateZone: HeartRateZone? = nil
  ) {
    self.workoutName = workoutName
    self.interval = interval
    self.next = next
    self.mode = mode
    self.isPaused = isPaused
    self.power = power
    self.heartRate = heartRate
    self.heartRateSource = heartRateSource
    self.heartRateZone = heartRateZone
  }
}

extension RideGlance {
  public static let freeRideTitle = "Free ride"

  public init(
    session: RideSession, ftp: Int, heartRateZones: ZoneSet?,
    powerDisplay: PowerDisplay = .standard
  ) {
    let zones = session.intervals.map { $0.zone(ftp: ftp) }
    let labels = session.intervals.map { Self.label(of: $0.step.target) }
    let ergTarget = { (interval: RideSession.Interval, position: TimeInterval) in
      session.mode == .erg ? interval.plannedPower(at: position).map(session.adjusted) : nil
    }
    let interval = session.currentInterval.map { interval in
      let zone = zones[interval.index]
      let label = labels[interval.index]
      let sameZone = zones.indices.filter { zones[$0] == zone && labels[$0] == label }
      return Interval(
        index: interval.index, zone: zone,
        numberInZone: sameZone.count > 1
          ? (sameZone.firstIndex(of: interval.index) ?? 0) + 1 : nil,
        countInZone: sameZone.count > 1 ? sameZone.count : nil,
        targetPower: ergTarget(interval, session.position), label: label,
        remaining: interval.end - session.position,
        duration: interval.end - interval.start)
    }
    let next = session.nextInterval.map {
      NextInterval(
        zone: zones[$0.index], targetPower: ergTarget($0, $0.start), label: labels[$0.index])
    }
    let reading = session.latest
    self.init(
      workoutName: session.workout.name, interval: interval, next: next, mode: session.mode,
      isPaused: session.isPaused, power: session.power(powerDisplay), heartRate: reading.heartRate,
      heartRateSource: reading.heartRateSource,
      heartRateZone: reading.heartRate.flatMap { bpm in
        heartRateZones.map { zones in
          let zone = zones.zone(containing: bpm)
          return HeartRateZone(label: zone.label, index: zone.index, zoneCount: zone.zoneCount)
        }
      })
  }

  static func label(of target: StepTarget?) -> String? {
    switch target {
    case .power: nil
    case .maxEffort: "Max effort"
    case .heartRate(.beatsPerMinute(let level)): "Heart rate \(text(level)) bpm"
    case .heartRate(.shareOfThreshold(let level)):
      "Heart rate \(text(level.scaled(by: 100)))% threshold"
    case nil: freeRideTitle
    }
  }

  private static func text(_ level: TargetLevel) -> String {
    let whole = { (value: Double) in "\(Int(value.rounded()))" }
    return switch level {
    case .constant(let value): whole(value)
    case .range(let low, let high): "\(whole(low))–\(whole(high))"
    case .ramp(let from, let to): "\(whole(from))→\(whole(to))"
    }
  }
}
