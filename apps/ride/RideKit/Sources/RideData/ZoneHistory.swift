import Foundation

public struct ZoneHistory: Codable, Equatable, Sendable {
  public struct Entry: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var day: Date
    public var changes: [ZoneChange]
    var unknownSportChanges: [SettingChange] = []

    private enum CodingKeys: String, CodingKey { case id, day, changes }

    init(
      day: Date, changes: [ZoneChange], unknownSportChanges: [SettingChange] = [],
      calendar: Calendar
    ) {
      let settingDay = SettingDay(day, calendar: calendar)
      id = Self.id(of: settingDay)
      self.day = day
      self.changes = changes.sorted { $0.applyOrder < $1.applyOrder }
      self.unknownSportChanges = unknownSportChanges
    }

    func apply(to profile: inout ZoneProfile) {
      for order in 0...3 {
        for change in changes where change.applyOrder == order { profile.apply(change) }
        for change in unknownSportChanges where change.unknownSportApplyOrder == order {
          profile.apply(unknownSport: change)
        }
      }
    }

    static func id(of day: SettingDay) -> UUID {
      let year = UInt16(clamping: day.year)
      return UUID(
        uuid: (
          0x5a, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x80, 0x00, 0x00, 0x00,
          UInt8(year >> 8), UInt8(year & 0xff), UInt8(day.month), UInt8(day.day)
        ))
    }
  }

  public private(set) var entries: [Entry] = []

  public init() {}

  init(
    _ changes: [(day: SettingDay, change: ZoneChange)],
    unknownSportChanges: [(day: SettingDay, change: SettingChange)] = [], calendar: Calendar
  ) {
    let days = Dictionary(grouping: changes, by: \.day)
    let unknownSportDays = Dictionary(grouping: unknownSportChanges, by: \.day)
    entries = Set(days.keys).union(unknownSportDays.keys).sorted().map { day in
      Entry(
        day: day.date(in: calendar), changes: days[day, default: []].map(\.change),
        unknownSportChanges: unknownSportDays[day, default: []].map(\.change), calendar: calendar)
    }
  }

  public func profile(on date: Date, calendar: Calendar = .current) -> ZoneProfile {
    let day = calendar.startOfDay(for: date)
    var profile = ZoneProfile()
    var tookEffect = false
    for entry in entries {
      if entry.day > day && tookEffect { break }
      let before = profile
      entry.apply(to: &profile)
      tookEffect = tookEffect || profile != before
    }
    return profile
  }

  public var current: ZoneProfile { profile(on: .distantFuture) }

  func settings(calendar: Calendar) -> [SettingAddress: SettingChange] {
    var settings: [SettingAddress: SettingChange] = [:]
    for entry in entries {
      let day = SettingDay(entry.day, calendar: calendar)
      for change in entry.changes {
        settings[SettingAddress(change.setting.key, on: day)] = change.setting
      }
    }
    return settings
  }

  public mutating func record(
    _ changes: [ZoneChange], on date: Date, calendar: Calendar = .current
  ) {
    let day = calendar.startOfDay(for: date)
    let index = entries.firstIndex { $0.day >= day } ?? entries.endIndex
    if index == entries.endIndex || entries[index].day != day {
      entries.insert(Entry(day: day, changes: [], calendar: calendar), at: index)
    }
    var dayChanges = entries[index].changes
    for change in changes {
      dayChanges.removeAll { $0.key == change.key }
      dayChanges.append(change)
    }
    entries[index] = Entry(
      day: day, changes: dayChanges, unknownSportChanges: entries[index].unknownSportChanges,
      calendar: calendar)
    dropNoOpChanges(at: index, among: Set(changes.map(\.key)))
  }

  public mutating func move(_ id: Entry.ID, to date: Date, calendar: Calendar = .current) {
    guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
    let moved = entries.remove(at: index)
    record(moved.changes, on: date, calendar: calendar)
  }

  public mutating func remove(_ id: Entry.ID) {
    entries.removeAll { $0.id == id }
  }

  private mutating func dropNoOpChanges(at index: Int, among recorded: Set<ZoneChange.Key>) {
    var profile = ZoneProfile()
    for entry in entries[..<index] {
      for change in entry.changes { profile.apply(change) }
    }
    entries[index].changes = entries[index].changes.filter { change in
      let before = profile
      profile.apply(change)
      return !recorded.contains(change.key) || profile != before
    }
    if entries[index].changes.isEmpty && entries[index].unknownSportChanges.isEmpty {
      entries.remove(at: index)
    }
  }
}
