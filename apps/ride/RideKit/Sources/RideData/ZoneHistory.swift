import Foundation

public struct ZoneHistory: Codable, Equatable, Sendable {
  public struct Entry: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var day: Date
    public var changes: [ZoneChange]
  }

  public private(set) var entries: [Entry] = []

  public init() {}

  public func profile(on date: Date, calendar: Calendar = .current) -> ZoneProfile {
    let day = calendar.startOfDay(for: date)
    var profile = ZoneProfile()
    for (index, entry) in entries.enumerated() where index == 0 || entry.day <= day {
      for change in entry.changes { profile.apply(change) }
    }
    return profile
  }

  public var current: ZoneProfile { profile(on: .distantFuture) }

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

  public mutating func move(_ id: Entry.ID, to date: Date, calendar: Calendar = .current) {
    guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
    let moved = entries.remove(at: index)
    record(moved.changes, on: date, calendar: calendar)
  }

  public mutating func remove(_ id: Entry.ID) {
    entries.removeAll { $0.id == id }
  }

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
