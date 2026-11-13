import Foundation

public struct SettingsLedger: Equatable, Codable, Sendable {
  public private(set) var account: String?
  public private(set) var cursor: String?
  private var registers: [SettingAddress: Register] = [:]

  private struct Register: Equatable, Sendable {
    var change: SettingChange?
    var updatedAt: SettingStamp
    var unsent: Bool
  }

  public init(account: String? = nil) {
    self.account = account
  }

  public var live: [(address: SettingAddress, change: SettingChange)] {
    registers.compactMap { address, register in register.change.map { (address, $0) } }
      .sorted { $0.address < $1.address }
  }

  public var unsent: [SettingWrite] {
    registers.filter(\.value.unsent)
      .map { SettingWrite($0.key, $0.value.change, at: $0.value.updatedAt) }
      .sorted { $0.address < $1.address }
  }

  public func write(at address: SettingAddress) -> SettingWrite? {
    registers[address].map { SettingWrite(address, $0.change, at: $0.updatedAt) }
  }

  public mutating func edit(_ address: SettingAddress, to change: SettingChange?, at now: Date) {
    let stamp = SettingStamp(now)
    let afterWhatThisDeviceSaw = registers[address].map { max(stamp, $0.updatedAt.next) } ?? stamp
    registers[address] = Register(change: change, updatedAt: afterWhatThisDeviceSaw, unsent: true)
  }

  public mutating func migrate(_ address: SettingAddress, to change: SettingChange) {
    registers[address] = Register(change: change, updatedAt: .beforeAnyEdit, unsent: true)
  }

  @discardableResult
  public mutating func receive(_ write: SettingWrite) -> Bool {
    if let local = registers[write.address], local.updatedAt > write.updatedAt { return false }
    let before = registers[write.address]?.change
    registers[write.address] = Register(
      change: write.change, updatedAt: write.updatedAt, unsent: false)
    return before != write.change
  }

  public mutating func received(through cursor: String) {
    self.cursor = cursor
  }

  public mutating func claim(for account: String) {
    guard self.account == nil else { return }
    self.account = account
  }

  public mutating func forgetAccount() {
    account = nil
    cursor = nil
    registers = registers.compactMapValues { register in
      register.change == nil
        ? nil
        : Register(
          change: register.change, updatedAt: register.updatedAt, unsent: true)
    }
  }

  private struct Record: Codable {
    var address: SettingAddress
    var change: SettingChange?
    var updatedAt: SettingStamp
    var unsent: Bool
  }

  private enum CodingKeys: String, CodingKey { case account, cursor, records }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    account = try container.decodeIfPresent(String.self, forKey: .account)
    cursor = try container.decodeIfPresent(String.self, forKey: .cursor)
    for record in try container.decode([Record].self, forKey: .records) {
      registers[record.address] = Register(
        change: record.change, updatedAt: record.updatedAt, unsent: record.unsent)
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encodeIfPresent(account, forKey: .account)
    try container.encodeIfPresent(cursor, forKey: .cursor)
    let records = registers.sorted { $0.key < $1.key }.map { address, register in
      Record(
        address: address, change: register.change, updatedAt: register.updatedAt,
        unsent: register.unsent)
    }
    try container.encode(records, forKey: .records)
  }
}
