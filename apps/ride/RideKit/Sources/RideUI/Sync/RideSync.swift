import CloudKit
import Foundation
import RideBluetooth
import RideData
import os

/// Keeps the rides in the rider's private iCloud database, so each device signed in to the same
/// Apple Account has every ride. A ride is a record named by its ID holding its FIT file, and as
/// a file never changes, records are only ever added and deleted.
///
/// Rides stay on the device without iCloud: the library is the source of truth, and the first
/// time a device syncs it sends every ride it has.
final class RideSync {
  static let containerIdentifier = "iCloud.com.trainstackhq.ride"
  private static let zoneID = CKRecordZone.ID(zoneName: "Rides")
  private static let recordType = "Ride"
  private static let fileKey = "file"

  /// Whether the app may use iCloud. Builds signed without the iCloud entitlement may not, and
  /// CloudKit stops the app if they try.
  static var isEntitled: Bool {
    #if os(macOS)
      guard let task = SecTaskCreateFromSelf(nil) else { return false }
      let services = SecTaskCopyValueForEntitlement(
        task, "com.apple.developer.icloud-services" as CFString, nil)
      return (services as? [String])?.contains("CloudKit") == true
    #else
      // iOS apps cannot read their entitlements, and every build that runs on a device is
      // signed with them. See AGENTS.md for the simulator.
      return true
    #endif
  }

  /// Proves to the rider's iPhone that this device is theirs, once iCloud has said who the
  /// rider is.
  private(set) var claim: RideClaim?
  /// Called with each ride that arrives from another device.
  var onReceive: ((Ride.ID) -> Void)?
  private let library: RideLibrary
  private let stateURL: URL
  private var engine: CKSyncEngine?
  private let log = Logger(subsystem: "com.trainstackhq.ride", category: "sync")

  init(library: RideLibrary, stateURL: URL = RideSync.defaultStateURL) {
    self.library = library
    self.stateURL = stateURL
  }

  static var defaultStateURL: URL {
    URL.applicationSupportDirectory.appending(path: "RideSync/State.json")
  }

  func start() {
    guard engine == nil, Self.isEntitled, library.isStored else { return }
    library.onChange = { [weak self] change in self?.send(change) }
    let state = loadState()
    let container = CKContainer(identifier: Self.containerIdentifier)
    let engine = CKSyncEngine(
      CKSyncEngine.Configuration(
        database: container.privateCloudDatabase, stateSerialization: state, delegate: self))
    self.engine = engine
    if state == nil { sendEverything(with: engine) }
    updateClaim(from: container)
  }

  private func updateClaim(from container: CKContainer) {
    claim = nil
    Task {
      do {
        claim = RideClaim(accountRecordName: try await container.userRecordID().recordName)
      } catch {
        log.info("No iCloud account to claim rides with: \(error.localizedDescription)")
      }
    }
  }

  /// Starts over with no sync state, for another Apple Account or none. The rides stay on the
  /// device, and go to the next account the rider signs in to.
  private func restart() {
    engine = nil
    try? FileManager.default.removeItem(at: stateURL)
    start()
  }

  private func send(_ change: RideLibrary.Change) {
    switch change {
    case .added(let id): engine?.state.add(pendingRecordZoneChanges: [.saveRecord(recordID(id))])
    case .removed(let id):
      engine?.state.add(pendingRecordZoneChanges: [.deleteRecord(recordID(id))])
    }
  }

  /// Makes sure the zone exists and sends every ride, for a device that has not synced yet or
  /// has just signed in.
  private func sendEverything(with engine: CKSyncEngine) {
    engine.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: Self.zoneID))])
    engine.state.add(
      pendingRecordZoneChanges: library.rides.map { .saveRecord(recordID($0.id)) })
  }

  private func recordID(_ id: Ride.ID) -> CKRecord.ID {
    CKRecord.ID(recordName: id, zoneID: Self.zoneID)
  }

  private func record(for recordID: CKRecord.ID) -> CKRecord? {
    guard let url = library.fileURL(for: recordID.recordName) else { return nil }
    let record = CKRecord(recordType: Self.recordType, recordID: recordID)
    record[Self.fileKey] = CKAsset(fileURL: url)
    return record
  }

  private func loadState() -> CKSyncEngine.State.Serialization? {
    guard let data = try? Data(contentsOf: stateURL) else { return nil }
    return try? JSONDecoder().decode(CKSyncEngine.State.Serialization.self, from: data)
  }

  private func saveState(_ state: CKSyncEngine.State.Serialization) {
    do {
      try FileManager.default.createDirectory(
        at: stateURL.deletingLastPathComponent(), withIntermediateDirectories: true)
      try JSONEncoder().encode(state).write(to: stateURL, options: .atomic)
    } catch {
      log.error("Sync state not saved: \(error.localizedDescription)")
    }
  }

  private func receive(_ record: CKRecord) {
    guard let url = (record[Self.fileKey] as? CKAsset)?.fileURL,
      let data = try? Data(contentsOf: url)
    else { return }
    do {
      if let id = try library.receive(data) { onReceive?(id) }
    } catch {
      log.error("Ride from iCloud not read: \(error.localizedDescription)")
    }
  }

  private func handleFailedSaves(
    _ failures: [CKSyncEngine.Event.SentRecordZoneChanges.FailedRecordSave],
    with engine: CKSyncEngine
  ) {
    for failure in failures {
      let recordID = failure.record.recordID
      switch failure.error.code {
      case .zoneNotFound, .userDeletedZone:
        // The rider removed Ride's data from iCloud, or it has not been created yet.
        engine.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: Self.zoneID))])
        engine.state.add(pendingRecordZoneChanges: [.saveRecord(recordID)])
      case .serverRecordChanged:
        // Another device sent the same ride, and a ride's record never changes.
        break
      default:
        log.error("Ride not sent to iCloud: \(failure.error.localizedDescription)")
      }
    }
  }
}

extension RideSync: CKSyncEngineDelegate {
  func handleEvent(_ event: CKSyncEngine.Event, syncEngine: CKSyncEngine) async {
    switch event {
    case .stateUpdate(let update):
      saveState(update.stateSerialization)
    case .accountChange(let change):
      switch change.changeType {
      case .signIn:
        sendEverything(with: syncEngine)
        updateClaim(from: CKContainer(identifier: Self.containerIdentifier))
      case .signOut, .switchAccounts: restart()
      @unknown default: break
      }
    case .fetchedRecordZoneChanges(let changes):
      for modification in changes.modifications { receive(modification.record) }
      for deletion in changes.deletions { library.removeReceived(deletion.recordID.recordName) }
    case .sentRecordZoneChanges(let sent):
      handleFailedSaves(sent.failedRecordSaves, with: syncEngine)
    default:
      break
    }
  }

  func nextRecordZoneChangeBatch(
    _ context: CKSyncEngine.SendChangesContext, syncEngine: CKSyncEngine
  ) async -> CKSyncEngine.RecordZoneChangeBatch? {
    let changes = syncEngine.state.pendingRecordZoneChanges.filter {
      context.options.scope.contains($0)
    }
    return await CKSyncEngine.RecordZoneChangeBatch(pendingChanges: changes) { recordID in
      await MainActor.run {
        guard let record = self.record(for: recordID) else {
          // The ride was removed, or never written to the device.
          syncEngine.state.remove(pendingRecordZoneChanges: [.saveRecord(recordID)])
          return nil
        }
        return record
      }
    }
  }
}
