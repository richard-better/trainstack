import Foundation
import RideData
import RideStrava

@testable import RideUI

actor FakeSettingsServer: SettingsServer {
  enum Call: Equatable {
    case history(since: String?, account: String)
    case write(count: Int, account: String)
  }

  private struct Row {
    var write: SettingWrite
    var revision: Int
  }

  private(set) var calls: [Call] = []
  private var rows: [String: [SettingAddress: Row]] = [:]
  private var revisions: [String: Int] = [:]
  private var signedIn: ActivityAccount?
  private var offline = false
  private var refusing: SettingChange?
  private var landingBeforeTheNextWrite: [SettingWrite] = []
  private var holdingWrites = false
  private var held: [CheckedContinuation<Void, Never>] = []

  init(signedInAs account: String? = "ada") {
    signedIn = account.map { ActivityAccount(id: $0, token: "token-\($0)") }
  }

  func signIn(as account: String?) {
    signedIn = account.map { ActivityAccount(id: $0, token: "token-\($0)") }
  }

  func goOffline(_ offline: Bool = true) { self.offline = offline }

  func refuse(_ change: SettingChange?) { refusing = change }

  func holdWrites() { holdingWrites = true }

  func landBeforeTheNextWrite(_ writes: [SettingWrite]) { landingBeforeTheNextWrite = writes }

  var isHoldingAWrite: Bool { !held.isEmpty }

  func releaseWrites() {
    holdingWrites = false
    for continuation in held { continuation.resume() }
    held = []
  }

  var writes: [Call] {
    calls.filter { if case .write = $0 { true } else { false } }
  }

  func live(of account: String) -> [SettingAddress: SettingChange] {
    (rows[account] ?? [:]).compactMapValues(\.write.change)
  }

  func row(_ address: SettingAddress, of account: String) -> SettingWrite? {
    rows[account]?[address]?.write
  }

  @discardableResult
  func apply(_ writes: [SettingWrite], for account: String) -> [SettingWrite] {
    for write in writes {
      let current = rows[account]?[write.address]?.write
      guard current.map({ Self.order(write) > Self.order($0) }) ?? true else { continue }
      revisions[account, default: 0] += 1
      rows[account, default: [:]][write.address] = Row(
        write: write, revision: revisions[account, default: 0])
    }
    return writes.compactMap { rows[account]?[$0.address]?.write }
  }

  private static func order(_ write: SettingWrite) -> (Int64, Int, String) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    let value = write.change.flatMap { try? encoder.encode($0) }.map {
      String(decoding: $0, as: UTF8.self)
    }
    return (write.updatedAt.milliseconds, write.isRemoval ? 1 : 0, value ?? "")
  }

  func signedInAccount() async throws -> ActivityAccount? {
    if offline, signedIn != nil { throw StravaError.unavailable }
    return signedIn
  }

  private func check(_ account: ActivityAccount) throws {
    guard signedIn == account else { throw StravaError.signedOut }
    if offline { throw StravaError.unavailable }
  }

  func settingsHistory(since cursor: String?, for account: ActivityAccount) async throws
    -> SettingsHistory
  {
    try check(account)
    calls.append(.history(since: cursor, account: account.id))
    let after = cursor.flatMap(Int.init) ?? 0
    let changed = (rows[account.id] ?? [:]).values.filter { $0.revision > after }
    return SettingsHistory(
      writes: changed.map(\.write).sorted { $0.address < $1.address },
      cursor: String(max(after, revisions[account.id] ?? 0)))
  }

  func writeSettings(_ writes: [SettingWrite], for account: ActivityAccount) async throws
    -> SettingsWriteResult
  {
    try check(account)
    calls.append(.write(count: writes.count, account: account.id))
    if let index = writes.firstIndex(where: { $0.change != nil && $0.change == refusing }) {
      return .refused(index: index, reason: "refused")
    }
    apply(landingBeforeTheNextWrite, for: account.id)
    landingBeforeTheNextWrite = []
    let answer = apply(writes, for: account.id)
    if holdingWrites { await withCheckedContinuation { held.append($0) } }
    return .stored(answer)
  }
}
