import Foundation

public struct SettingWrite: Equatable, Codable, Sendable {
  public var address: SettingAddress
  public var change: SettingChange?
  public var updatedAt: SettingStamp

  public init(_ address: SettingAddress, _ change: SettingChange?, at updatedAt: SettingStamp) {
    self.address = address
    self.change = change
    self.updatedAt = updatedAt
  }

  public var isRemoval: Bool { change == nil }
}
