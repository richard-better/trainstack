import CryptoKit
import Foundation
import RideData
import RideStrava
import os

final class SettingsSync {
  private let store: RiderSettingsStore
  private let server: any SettingsServer
  private let directory: URL
  private var refusedThisLaunch: [SettingWrite] = []
  private let log = Logger(subsystem: "com.trainstackhq.ride", category: "settings-sync")
  private lazy var passes = SyncPasses(of: "Settings", log: log) { [weak self] in
    try await self?.sync()
  }

  var onSignedOut: (() -> Void)? {
    get { passes.onSignedOut }
    set { passes.onSignedOut = newValue }
  }

  init(store: RiderSettingsStore, server: any SettingsServer, directory: URL = defaultDirectory) {
    self.store = store
    self.server = server
    self.directory = directory
  }

  static var defaultDirectory: URL {
    URL.applicationSupportDirectory.appending(path: "SettingsSync", directoryHint: .isDirectory)
  }

  func start() {
    guard store.isStored else { return }
    store.onEdit = { [weak self] in self?.syncSoon() }
    syncSoon()
  }

  func accountChanged() {
    passes.restart()
  }

  func accountDeleted(_ account: String) {
    try? FileManager.default.removeItem(at: ledgerURL(of: account))
    if store.settings.ledger.account == account { store.forgetAccount() }
    accountChanged()
  }

  func syncSoon() {
    passes.soon()
  }

  func sync() async throws {
    guard let account = try await server.signedInAccount() else { throw StravaError.signedOut }
    try Task.checkCancellation()
    try switchToTheLedger(of: account.id)
    let history = try await server.settingsHistory(
      since: store.settings.ledger.cursor, for: account)
    try checkStillSyncing(account)
    store.receive(history.writes, through: history.cursor)
    let unsent = store.settings.ledger.unsent.filter { !refusedThisLaunch.contains($0) }
    for start in stride(from: 0, to: unsent.count, by: TrainStackClient.maxSettingWrites) {
      let batch = Array(
        unsent[start..<min(start + TrainStackClient.maxSettingWrites, unsent.count)])
      let result = try await server.writeSettings(batch, for: account)
      try checkStillSyncing(account)
      switch result {
      case .stored(let writes):
        store.settle(writes)
      case .refused(let index, let reason):
        guard batch.indices.contains(index) else { throw StravaError.unavailable }
        refusedThisLaunch.append(batch[index])
        log.error("TrainStack refused a setting: \(reason, privacy: .public)")
        passes.passAgain()
        return
      }
    }
  }

  private func checkStillSyncing(_ account: ActivityAccount) throws {
    try Task.checkCancellation()
    guard store.settings.ledger.account == account.id else { throw CancellationError() }
  }

  private func switchToTheLedger(of account: String) throws {
    let ledger = store.settings.ledger
    guard ledger.account != account else { return }
    guard let owner = ledger.account else {
      store.claim(for: account)
      return
    }
    try keep(ledger, of: owner)
    let url = ledgerURL(of: account)
    let kept = (try? Data(contentsOf: url))
      .flatMap { try? JSONDecoder().decode(SettingsLedger.self, from: $0) }
    store.replaceLedger(with: kept ?? SettingsLedger(account: account))
    try? FileManager.default.removeItem(at: url)
  }

  private func keep(_ ledger: SettingsLedger, of account: String) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try JSONEncoder().encode(ledger).write(to: ledgerURL(of: account), options: .atomic)
  }

  private func ledgerURL(of account: String) -> URL {
    let name = SHA256.hash(data: Data(account.utf8)).map { String(format: "%02x", $0) }.joined()
    return directory.appending(path: "\(name).json")
  }
}
