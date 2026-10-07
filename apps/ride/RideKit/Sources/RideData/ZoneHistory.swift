import Foundation

/// One change to a rider's zones.
public enum ZoneChange: Codable, Equatable, Sendable {
  case threshold(Threshold, scope: ZoneScope, value: Int?)
  case choice(ZoneMetric, scope: ZoneScope, ZoneChoice)
  /// Whether a listed sport keeps its own zones for a metric rather than using Default's.
  case ownZones(ZoneMetric, sport: Sport, Bool)
  case listed(Sport, Bool)

  /// What the change sets. A later change with the same key on the same day replaces it.
  enum Key: Hashable {
    case threshold(Threshold, ZoneScope)
    case choice(ZoneMetric, ZoneScope)
    case ownZones(ZoneMetric, Sport)
    case listed(Sport)
  }

  var key: Key {
    switch self {
    case .threshold(let threshold, let scope, _): .threshold(threshold, scope)
    case .choice(let metric, let scope, _): .choice(metric, scope)
    case .ownZones(let metric, let sport, _): .ownZones(metric, sport)
    case .listed(let sport, _): .listed(sport)
    }
  }
}

/// Every change to a rider's zones, by the day it took effect.
///
/// An activity is analysed with the zones in effect on its day: every change up to and
/// including that day. A change holds until a later one of the same setting, so a change dated
/// in the past carries forward. Activities from before the first day use that day's zones.
public struct ZoneHistory: Codable, Equatable, Sendable {
  public struct Entry: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    /// The start of the day the changes took effect.
    public var day: Date
    public var changes: [ZoneChange]
  }

  /// Oldest first, one per day, none empty.
  public private(set) var entries: [Entry] = []

  public init() {}

  /// The zones in effect on `date`.
  public func profile(on date: Date, calendar: Calendar = .current) -> ZoneProfile {
    let day = calendar.startOfDay(for: date)
    var profile = ZoneProfile()
    for (index, entry) in entries.enumerated() where index == 0 || entry.day <= day {
      for change in entry.changes { profile.apply(change) }
    }
    return profile
  }

  /// The zones in effect now, including every change.
  public var current: ZoneProfile { profile(on: .distantFuture) }

  /// Records `changes` as taking effect on the day of `date`, replacing any change that day to
  /// the same setting. Changes that leave the zones as they were are dropped.
  public mutating func record(
    _ changes: [ZoneChange], on date: Date, calendar: Calendar = .current
  ) {
    let day = calendar.startOfDay(for: date)
    let index = entries.firstIndex { $0.day >= day } ?? entries.endIndex
    if index == entries.endIndex || entries[index].day != day {
      entries.insert(Entry(id: UUID(), day: day, changes: []), at: index)
    }
    for change in changes {
      entries[index].changes.removeAll { $0.key == change.key }
      entries[index].changes.append(change)
    }
    dropNoOpChanges(at: index)
  }

  /// Moves an entry to the day of `date`. When that day already has changes, they are merged and
  /// the moved ones win.
  public mutating func move(_ id: Entry.ID, to date: Date, calendar: Calendar = .current) {
    guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
    let moved = entries.remove(at: index)
    record(moved.changes, on: date, calendar: calendar)
  }

  public mutating func remove(_ id: Entry.ID) {
    entries.removeAll { $0.id == id }
  }

  /// Drops the changes in an entry that change nothing, and the entry if none are left.
  private mutating func dropNoOpChanges(at index: Int) {
    var profile = ZoneProfile()
    for entry in entries[..<index] {
      for change in entry.changes { profile.apply(change) }
    }
    entries[index].changes = entries[index].changes.filter { change in
      let before = profile
      profile.apply(change)
      return profile != before
    }
    if entries[index].changes.isEmpty { entries.remove(at: index) }
  }
}
