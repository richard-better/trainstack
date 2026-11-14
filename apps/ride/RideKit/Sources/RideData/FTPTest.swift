import Foundation

public struct FTPTest: Codable, Equatable, Identifiable, Sendable {
  public enum Kind: String, CaseIterable, Codable, Sendable {
    case ramp, twentyMinute, eightMinute, hour, other

    public var wireName: String {
      switch self {
      case .ramp: "ramp"
      case .twentyMinute: "twenty_minute"
      case .eightMinute: "eight_minute"
      case .hour: "hour"
      case .other: "other"
      }
    }

    public init(wireName: String) {
      self = Self.allCases.first { $0.wireName == wireName } ?? .other
    }

    public var name: String {
      switch self {
      case .ramp: "Ramp test"
      case .twentyMinute: "20-minute test"
      case .eightMinute: "8-minute test"
      case .hour: "Hour effort"
      case .other: "Other test"
      }
    }
  }

  public var id: UUID
  public var date: Date
  public var kind: Kind
  public var ftp: Int
  public var scope: ZoneScope

  public init(
    id: UUID = UUID(), date: Date, kind: Kind, ftp: Int, scope: ZoneScope
  ) {
    self.id = id
    self.date = date
    self.kind = kind
    self.ftp = ftp
    self.scope = scope
  }

  public var setting: SettingChange {
    .thresholdTest(
      id: id.uuidString.lowercased(), sport: scope.wireSport, threshold: Threshold.ftp.wireName,
      protocol: kind.wireName, value: ftp, activityID: nil)
  }

  public init?(_ setting: SettingChange, on day: SettingDay, calendar: Calendar = .current) {
    guard case .thresholdTest(let id, let sport, let threshold, let method, let value, _) = setting,
      threshold == Threshold.ftp.wireName, let id = UUID(uuidString: id),
      let scope = ZoneScope(wireSport: sport)
    else { return nil }
    self.init(
      id: id, date: day.date(in: calendar), kind: Kind(wireName: method), ftp: value, scope: scope)
  }
}
