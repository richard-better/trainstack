import Foundation
import RideData

public struct CalendarRange: Hashable, Codable, Sendable {
  public struct Totals: Hashable, Codable, Sendable {
    public var seconds: Double
    public var meters: Double
    public var load: Double

    public init(seconds: Double = 0, meters: Double = 0, load: Double = 0) {
      self.seconds = seconds
      self.meters = meters
      self.load = load
    }
  }

  public struct PlannedAgainstCompleted: Hashable, Codable, Sendable {
    public var planned: Totals
    public var completed: Totals

    public init(planned: Totals = Totals(), completed: Totals = Totals()) {
      self.planned = planned
      self.completed = completed
    }
  }

  public struct Day: Hashable, Codable, Sendable {
    public var day: SettingDay
    public var planned: [PlannedItem]
    public var activities: [CalendarActivity]
    public var totals: PlannedAgainstCompleted

    public init(
      day: SettingDay, planned: [PlannedItem] = [], activities: [CalendarActivity] = [],
      totals: PlannedAgainstCompleted = PlannedAgainstCompleted()
    ) {
      self.day = day
      self.planned = planned
      self.activities = activities
      self.totals = totals
    }
  }

  public struct Week: Hashable, Codable, Sendable {
    public var start: SettingDay
    public var totals: PlannedAgainstCompleted

    public init(start: SettingDay, totals: PlannedAgainstCompleted = PlannedAgainstCompleted()) {
      self.start = start
      self.totals = totals
    }
  }

  public var today: SettingDay
  public var days: [Day]
  public var weeks: [Week]
  public var analysesDue: Int

  public init(today: SettingDay, days: [Day], weeks: [Week], analysesDue: Int = 0) {
    self.today = today
    self.days = days
    self.weeks = weeks
    self.analysesDue = analysesDue
  }
}
