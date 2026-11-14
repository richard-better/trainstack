import Foundation

public struct MeasuredDay: Hashable, Codable, Sendable {
  public let day: SettingDay
  public let sleepSeconds: Int?
  public let restingHeartRateBpm: Double?
  public let hrvMs: Double?

  public init(day: SettingDay, sleepSeconds: Int?, restingHeartRateBpm: Double?, hrvMs: Double?) {
    self.day = day
    self.sleepSeconds = sleepSeconds
    self.restingHeartRateBpm = restingHeartRateBpm
    self.hrvMs = hrvMs
  }

  public var isEmpty: Bool { sleepSeconds == nil && restingHeartRateBpm == nil && hrvMs == nil }

  public static func days(
    _ days: [SettingDay], asleep: [DateInterval], restingHeartRate: [HealthActivity.Reading],
    hrv: [HealthActivity.Reading], calendar: Calendar
  ) -> [MeasuredDay] {
    let sleep = merged(asleep)
    return days.map { day in
      let start = day.date(in: calendar)
      let nextDay = calendar.date(byAdding: .day, value: 1, to: start) ?? start
      let previousDay = calendar.date(byAdding: .day, value: -1, to: start) ?? start
      let night = DateInterval(
        start: calendar.date(bySettingHour: 12, minute: 0, second: 0, of: previousDay) ?? start,
        end: calendar.date(bySettingHour: 12, minute: 0, second: 0, of: start) ?? start)
      let nightSleep = sleep.compactMap { $0.intersection(with: night) }
      let asleepSeconds = nightSleep.reduce(0) { $0 + $1.duration }
      let duringSleep = hrv.filter { reading in
        nightSleep.contains { $0.contains(reading.date) }
      }
      let duringNight = hrv.filter { night.start <= $0.date && $0.date < night.end }
      return MeasuredDay(
        day: day,
        sleepSeconds: asleepSeconds > 0 ? Int(asleepSeconds.rounded()) : nil,
        restingHeartRateBpm: mean(
          restingHeartRate.filter { start <= $0.date && $0.date < nextDay }, step: 0.1),
        hrvMs: mean(duringSleep.isEmpty ? duringNight : duringSleep, step: 0.1))
    }
  }

  static func merged(_ intervals: [DateInterval]) -> [DateInterval] {
    var merged: [DateInterval] = []
    for interval in intervals.sorted(by: { ($0.start, $0.end) < ($1.start, $1.end) })
    where interval.duration > 0 {
      if let last = merged.last, interval.start <= last.end {
        merged[merged.count - 1] = DateInterval(
          start: last.start, end: max(last.end, interval.end))
      } else {
        merged.append(interval)
      }
    }
    return merged
  }

  private static func mean(_ readings: [HealthActivity.Reading], step: Double) -> Double? {
    let values = readings.map(\.value).filter { $0.isFinite && $0 > 0 }
    guard !values.isEmpty else { return nil }
    let mean = values.reduce(0, +) / Double(values.count)
    return (mean / step).rounded() * step
  }
}
