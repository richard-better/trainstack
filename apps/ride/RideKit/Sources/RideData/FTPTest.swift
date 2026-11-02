import Foundation

public struct FTPTest: Codable, Equatable, Identifiable, Sendable {
  public enum Kind: String, CaseIterable, Codable, Sendable {
    case ramp, twentyMinute, eightMinute, hour, other

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
}
