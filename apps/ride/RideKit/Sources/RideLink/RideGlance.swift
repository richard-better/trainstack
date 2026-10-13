import Foundation
import RideData

/// What the watch shows of a ride the phone or Mac is running: where the rider is in the
/// workout, what the trainer is asked for and what the sensors say. Sent about once a second.
public struct RideGlance: Codable, Equatable, Sendable {
  public struct Interval: Codable, Equatable, Sendable {
    /// Position in the workout, from 0.
    public var index: Int
    /// The interval's zone, which also names it.
    public var zone: PowerZone
    /// Which of the workout's intervals in this zone it is, such as the second of three. Nil
    /// when the zone has only one.
    public var number: Int?
    public var count: Int?
    /// The power the trainer holds, after the rider's adjustment. Nil outside ERG mode.
    public var targetPower: Int?
    public var remaining: TimeInterval
    public var duration: TimeInterval

    public init(
      index: Int, zone: PowerZone, number: Int? = nil, count: Int? = nil,
      targetPower: Int? = nil, remaining: TimeInterval, duration: TimeInterval
    ) {
      self.index = index
      self.zone = zone
      self.number = number
      self.count = count
      self.targetPower = targetPower
      self.remaining = remaining
      self.duration = duration
    }

    /// Such as "Threshold 2/3".
    public var title: String {
      guard let number, let count else { return zone.name }
      return "\(zone.name) \(number)/\(count)"
    }

    /// How much of the interval has been ridden, from 0 to 1.
    public var progress: Double {
      duration > 0 ? min(max(1 - remaining / duration, 0), 1) : 1
    }
  }

  /// The interval after the current one.
  public struct Next: Codable, Equatable, Sendable {
    public var zone: PowerZone
    /// Nil outside ERG mode.
    public var targetPower: Int?

    public init(zone: PowerZone, targetPower: Int? = nil) {
      self.zone = zone
      self.targetPower = targetPower
    }
  }

  /// A heart rate zone, by its place in the rider's zones.
  public struct HeartRateZone: Codable, Equatable, Sendable {
    /// The zone's number, such as 2 or 5a.
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
  /// Nil once the workout is done.
  public var interval: Interval?
  public var next: Next?
  public var mode: TrainerMode
  public var isPaused: Bool
  public var power: Int?
  public var heartRate: Int?
  public var heartRateSource: HeartRateSource?
  public var heartRateZone: HeartRateZone?

  public init(
    workoutName: String, interval: Interval? = nil, next: Next? = nil, mode: TrainerMode = .erg,
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
  /// The glance of `session` as it stands, for a rider with this FTP and heart rate zones, with
  /// power shown as they chose.
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
        number: sameZone.count > 1 ? (sameZone.firstIndex(of: interval.index) ?? 0) + 1 : nil,
        count: sameZone.count > 1 ? sameZone.count : nil,
        targetPower: ergTarget(interval), remaining: interval.end - session.position,
        duration: interval.end - interval.start)
    }
    let next = session.nextInterval.map {
      Next(zone: zones[$0.index], targetPower: ergTarget($0))
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
