import Foundation
import RideData

public struct RideGlance: Codable, Equatable, Sendable {
  public struct Interval: Codable, Equatable, Sendable {
    public var index: Int
    public var zone: PowerZone
    public var numberInZone: Int?
    public var countInZone: Int?
    public var targetPower: Int?
    public var remaining: TimeInterval
    public var duration: TimeInterval

    public init(
      index: Int, zone: PowerZone, numberInZone: Int? = nil, countInZone: Int? = nil,
      targetPower: Int? = nil, remaining: TimeInterval, duration: TimeInterval
    ) {
      self.index = index
      self.zone = zone
      self.numberInZone = numberInZone
      self.countInZone = countInZone
      self.targetPower = targetPower
      self.remaining = remaining
      self.duration = duration
    }

    public var title: String {
      guard let numberInZone, let countInZone else { return zone.name }
      return "\(zone.name) \(numberInZone)/\(countInZone)"
    }

    public var progress: Double {
      duration > 0 ? min(max(1 - remaining / duration, 0), 1) : 1
    }
  }

  public struct NextInterval: Codable, Equatable, Sendable {
    public var zone: PowerZone
    public var targetPower: Int?

    public init(zone: PowerZone, targetPower: Int? = nil) {
      self.zone = zone
      self.targetPower = targetPower
    }
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
  public init(
    session: RideSession, ftp: Int, heartRateZones: ZoneSet?,
    powerDisplay: PowerDisplay = .standard
  ) {
    let zones = session.intervals.map { PowerZone.zone(power: $0.plannedPower, ftp: ftp) }
    let ergTarget = { (interval: RideSession.Interval) in
      session.mode == .erg ? session.adjusted(interval.plannedPower) : nil
    }
    let interval = session.currentInterval.map { interval in
      let zone = zones[interval.index]
      let sameZone = zones.indices.filter { zones[$0] == zone }
      return Interval(
        index: interval.index, zone: zone,
        numberInZone: sameZone.count > 1
          ? (sameZone.firstIndex(of: interval.index) ?? 0) + 1 : nil,
        countInZone: sameZone.count > 1 ? sameZone.count : nil,
        targetPower: ergTarget(interval), remaining: interval.end - session.position,
        duration: interval.end - interval.start)
    }
    let next = session.nextInterval.map {
      NextInterval(zone: zones[$0.index], targetPower: ergTarget($0))
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
}
