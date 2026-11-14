import CryptoKit
import Foundation
import RideData
import RideStrava
import os

final class HealthImport {
  static let source = "apple_health"
  static let settleTime: TimeInterval = 5 * 60
  static let onKey = "healthImportIsOn"

  private let store: any HealthWorkoutStore
  private let server: any ActivityServer
  private let directory: URL
  private let defaults: UserDefaults
  private let now: () -> Date
  private var states: [String: HealthImportState] = [:]
  private var refusedThisLaunch: Set<String> = []
  private var settling: Task<Void, Never>?
  private let log = Logger(subsystem: "com.trainstackhq.ride", category: "health-import")
  private lazy var passes = SyncPasses(of: "Health workouts", log: log) { [weak self] in
    try await self?.sync()
  }

  var onImported: (() -> Void)?

  var onSignedOut: (() -> Void)? {
    get { passes.onSignedOut }
    set { passes.onSignedOut = newValue }
  }

  init(
    store: any HealthWorkoutStore, server: any ActivityServer,
    directory: URL = defaultDirectory, defaults: UserDefaults = .standard,
    now: @escaping () -> Date = Date.init
  ) {
    self.store = store
    self.server = server
    self.directory = directory
    self.defaults = defaults
    self.now = now
  }

  static var defaultDirectory: URL {
    URL.applicationSupportDirectory.appending(path: "HealthImport", directoryHint: .isDirectory)
  }

  var isOn: Bool {
    get { defaults.bool(forKey: Self.onKey) }
    set {
      defaults.set(newValue, forKey: Self.onKey)
      passes.restart()
    }
  }

  func accountChanged() {
    passes.restart()
  }

  func syncSoon() {
    passes.soon()
  }

  func sync() async throws {
    guard isOn else { return }
    guard let account = try await server.signedInAccount() else { throw StravaError.signedOut }
    try Task.checkCancellation()
    let settledBefore = now().addingTimeInterval(-Self.settleTime)
    var settlingUntil: Date?
    let entries = try await store.workouts().sorted {
      ($0.endDate, $0.id) > ($1.endDate, $1.id)
    }
    for entry in entries where needsImporting(entry, account: account.id) {
      guard entry.endDate <= settledBefore else {
        let settled = entry.endDate.addingTimeInterval(Self.settleTime)
        settlingUntil = min(settlingUntil ?? settled, settled)
        continue
      }
      try Task.checkCancellation()
      guard isOn else { return }
      guard let activity = try await store.activity(of: entry.id) else { continue }
      let file = ActivityFile(
        data: FITEncoder.encode(activity), fileName: "\(entry.id).fit", source: Self.source,
        sourceID: entry.id, startedAt: activity.startDate)
      let result = try await server.upload(file, for: account)
      try Task.checkCancellation()
      receive(result, for: entry.id, account: account.id)
    }
    settling?.cancel()
    settling = settlingUntil.map { date in
      Task { [weak self, now] in
        try? await Task.sleep(for: .seconds(max(date.timeIntervalSince(now()), 1)))
        guard !Task.isCancelled else { return }
        self?.syncSoon()
      }
    }
  }

  private func needsImporting(_ entry: HealthWorkoutEntry, account: String) -> Bool {
    let state = state(of: account)
    return !entry.writtenByRide && !state.imported.contains(entry.id)
      && !state.deleted.contains(entry.id) && !refusedThisLaunch.contains(entry.id)
  }

  private func receive(_ result: ActivityUploadResult, for id: String, account: String) {
    switch result {
    case .stored:
      update(account) { $0.imported.insert(id) }
      onImported?()
    case .deletedOnTheServer:
      update(account) { $0.deleted.insert(id) }
    case .refused:
      refusedThisLaunch.insert(id)
      log.error("Trainstack refused a Health workout")
    }
  }

  private func stateURL(of account: String) -> URL {
    let name = SHA256.hash(data: Data(account.utf8)).map { String(format: "%02x", $0) }.joined()
    return directory.appending(path: "\(name).json")
  }

  func state(of account: String) -> HealthImportState {
    if let state = states[account] { return state }
    let state =
      (try? Data(contentsOf: stateURL(of: account)))
      .flatMap { try? JSONDecoder().decode(HealthImportState.self, from: $0) }
      ?? HealthImportState()
    states[account] = state
    return state
  }

  private func update(_ account: String, _ change: (inout HealthImportState) -> Void) {
    var state = state(of: account)
    change(&state)
    guard state != states[account] else { return }
    states[account] = state
    guard let data = try? JSONEncoder().encode(state) else { return }
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try data.write(to: stateURL(of: account), options: .atomic)
    } catch {
      log.error("Health import state not saved: \(error.localizedDescription)")
    }
  }
}
