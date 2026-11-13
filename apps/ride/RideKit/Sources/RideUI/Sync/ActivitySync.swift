import CryptoKit
import Foundation
import RideStrava
import os

final class ActivitySync {
  private let library: RideLibrary
  private let server: any ActivityServer
  private let directory: URL
  private var states: [String: ActivitySyncState] = [:]
  private var refusedThisLaunch: Set<Ride.ID> = []
  private var running: Task<Void, Never>?
  private var generation = 0
  private var wantsAnotherPass = false
  private var retry: Task<Void, Never>?
  private var failuresInARow = 0
  private let log = Logger(subsystem: "com.trainstackhq.ride", category: "activity-sync")

  init(library: RideLibrary, server: any ActivityServer, directory: URL = defaultDirectory) {
    self.library = library
    self.server = server
    self.directory = directory
  }

  static var defaultDirectory: URL {
    URL.applicationSupportDirectory.appending(path: "ActivitySync", directoryHint: .isDirectory)
  }

  func start() {
    guard library.isStored else { return }
    library.onChange = { [weak self] change in self?.libraryChanged(change) }
    syncSoon()
  }

  private func libraryChanged(_ change: RideLibrary.Change) {
    remember(change)
    syncSoon()
  }

  func remember(_ change: RideLibrary.Change) {
    guard case .removed(let id) = change, let account = lastAccountID else { return }
    update(account) { state in
      guard state.deleted.insert(id).inserted else { return }
      state.onServer.remove(id)
      state.deletionsToSend.insert(id)
    }
  }

  func accountChanged() {
    running?.cancel()
    running = nil
    retry?.cancel()
    retry = nil
    failuresInARow = 0
    syncSoon()
  }

  func syncSoon() {
    wantsAnotherPass = true
    guard running == nil else { return }
    retry?.cancel()
    retry = nil
    generation += 1
    let generation = generation
    running = Task {
      await syncUntilSettled()
      if self.generation == generation { running = nil }
    }
  }

  private func syncUntilSettled() async {
    while wantsAnotherPass, !Task.isCancelled {
      wantsAnotherPass = false
      do {
        try await sync()
        failuresInARow = 0
      } catch is CancellationError {
        return
      } catch StravaError.signedOut {
        return
      } catch {
        failuresInARow += 1
        log.error("Rides not synced with TrainStack: \(error.localizedDescription)")
        retryLater()
        return
      }
    }
  }

  private func retryLater() {
    let delay = Self.retryDelay(afterFailures: failuresInARow)
    retry = Task { [weak self] in
      try? await Task.sleep(for: delay)
      guard !Task.isCancelled else { return }
      self?.syncSoon()
    }
  }

  static func retryDelay(afterFailures failures: Int) -> Duration {
    .seconds(min(30 << min(max(failures - 1, 0), 6), 30 * 60))
  }

  func sync() async throws {
    guard let account = try await server.signedInAccount() else { return }
    lastAccountID = account.id
    for id in state(of: account.id).deletionsToSend.sorted() {
      try await server.deleteActivity(id, for: account)
      update(account.id) { $0.deletionsToSend.remove(id) }
    }
    let onServer = try await server.activityIDs(for: account)
    dropRidesDeletedOnTheServer(keeping: onServer, account: account.id)
    for ride in library.rides where needsUploading(ride.id, account: account.id) {
      try Task.checkCancellation()
      let result = try await server.upload(ride.activityFile, for: account)
      receive(result, for: ride.id, account: account.id)
    }
  }

  private func needsUploading(_ id: Ride.ID, account: String) -> Bool {
    let state = state(of: account)
    return library[id] != nil && !state.onServer.contains(id) && !state.deleted.contains(id)
      && !refusedThisLaunch.contains(id)
  }

  private func dropRidesDeletedOnTheServer(keeping onServer: Set<Ride.ID>, account: String) {
    let known = state(of: account).onServer
    let deletedElsewhere = known.subtracting(onServer)
    update(account) { state in
      state.onServer = known.intersection(onServer)
        .union(onServer.filter { library[$0] != nil })
      state.deleted.formUnion(deletedElsewhere)
    }
    for id in deletedElsewhere.sorted() { library.remove(id) }
  }

  private func receive(_ result: ActivityUploadResult, for id: Ride.ID, account: String) {
    switch result {
    case .stored:
      update(account) { $0.onServer.insert(id) }
    case .deletedOnTheServer:
      update(account) { $0.deleted.insert(id) }
      library.remove(id)
    case .refused:
      refusedThisLaunch.insert(id)
      log.error("TrainStack refused ride \(id, privacy: .public)")
    }
  }

  private var lastAccountURL: URL { directory.appending(path: "LastAccount") }

  private lazy var lastAccountID: String? =
    (try? String(contentsOf: lastAccountURL, encoding: .utf8))
  {
    didSet {
      guard let lastAccountID, lastAccountID != oldValue else { return }
      write(Data(lastAccountID.utf8), to: lastAccountURL)
    }
  }

  private func stateURL(of account: String) -> URL {
    let name = SHA256.hash(data: Data(account.utf8)).map { String(format: "%02x", $0) }.joined()
    return directory.appending(path: "\(name).json")
  }

  func state(of account: String) -> ActivitySyncState {
    if let state = states[account] { return state }
    let state =
      (try? Data(contentsOf: stateURL(of: account)))
      .flatMap { try? JSONDecoder().decode(ActivitySyncState.self, from: $0) }
      ?? ActivitySyncState()
    states[account] = state
    return state
  }

  private func update(_ account: String, _ change: (inout ActivitySyncState) -> Void) {
    var state = state(of: account)
    change(&state)
    guard state != states[account] else { return }
    states[account] = state
    guard let data = try? JSONEncoder().encode(state) else { return }
    write(data, to: stateURL(of: account))
  }

  private func write(_ data: Data, to url: URL) {
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try data.write(to: url, options: .atomic)
    } catch {
      log.error("Activity sync state not saved: \(error.localizedDescription)")
    }
  }
}
