import CloudKit
import Foundation
import RideBluetooth
import RideData
import os

final class RideSync {
  static let containerIdentifier = "iCloud.com.trainstackhq.ride"
  private static let zoneID = CKRecordZone.ID(zoneName: "Rides")
  private static let recordType = "Ride"
  private static let fileKey = "file"
  private static let secretRecordType = "ClaimSecret"
  private static let secretRecordID = CKRecord.ID(recordName: "claim-secret", zoneID: zoneID)
  private static let secretKey = "secret"

  static var isEntitled: Bool {
    #if os(macOS)
      guard let task = SecTaskCreateFromSelf(nil) else { return false }
      let services = SecTaskCopyValueForEntitlement(
        task, "com.apple.developer.icloud-services" as CFString, nil)
      return (services as? [String])?.contains("CloudKit") == true
    #else
      return true
    #endif
  }

  var claim: RideClaim? { secret.map(RideClaim.init(secret:)) }
  private var secret: Data?
  var onRideFromAnotherDevice: ((Ride.ID) -> Void)?
  private let library: RideLibrary
  private let stateURL: URL
  private var engine: CKSyncEngine?
  private let log = Logger(subsystem: "com.trainstackhq.ride", category: "sync")

  init(library: RideLibrary, stateURL: URL = RideSync.defaultStateURL) {
    self.library = library
    self.stateURL = stateURL
  }

  private var secretURL: URL { stateURL.deletingLastPathComponent().appending(path: "ClaimSecret") }

  static var defaultStateURL: URL {
    URL.applicationSupportDirectory.appending(path: "RideSync/State.json")
  }

  func start() {
    guard engine == nil, Self.isEntitled, library.isStored else { return }
    library.onLocalChange = { [weak self] change in self?.send(change) }
    let state = loadState()
    let container = CKContainer(identifier: Self.containerIdentifier)
    let engine = CKSyncEngine(
      CKSyncEngine.Configuration(
        database: container.privateCloudDatabase, stateSerialization: state, delegate: self))
    self.engine = engine
    secret = try? Data(contentsOf: secretURL)
    if secret == nil { proposeNewSecret(with: engine) }
    if state == nil { sendEverything(with: engine) }
  }

  private func proposeNewSecret(with engine: CKSyncEngine) {
    store(RideClaim.secret())
    engine.state.add(pendingRecordZoneChanges: [.saveRecord(Self.secretRecordID)])
  }

  private func store(_ secret: Data) {
    self.secret = secret
    do {
      try FileManager.default.createDirectory(
        at: secretURL.deletingLastPathComponent(), withIntermediateDirectories: true)
      try secret.write(
        to: secretURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    } catch {
      log.error("Claim secret not saved: \(error.localizedDescription)")
    }
  }

  private func adoptSecret(from record: CKRecord?) {
    guard let secret = record?.encryptedValues[Self.secretKey] as? Data, secret != self.secret
    else { return }
    store(secret)
  }

  private func restartForAnotherAccount() {
    engine = nil
    secret = nil
    try? FileManager.default.removeItem(at: stateURL)
    try? FileManager.default.removeItem(at: secretURL)
    start()
  }

  private func send(_ change: RideLibrary.Change) {
    switch change {
    case .added(let id): engine?.state.add(pendingRecordZoneChanges: [.saveRecord(recordID(id))])
    case .removed(let id):
      engine?.state.add(pendingRecordZoneChanges: [.deleteRecord(recordID(id))])
    }
  }

  private func sendEverything(with engine: CKSyncEngine) {
    engine.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: Self.zoneID))])
    engine.state.add(
      pendingRecordZoneChanges: [.saveRecord(Self.secretRecordID)]
        + library.rides.map { .saveRecord(recordID($0.id)) })
  }

  func recordID(_ id: Ride.ID) -> CKRecord.ID {
    CKRecord.ID(recordName: id, zoneID: Self.zoneID)
  }

  func record(for recordID: CKRecord.ID) -> CKRecord? {
    if recordID == Self.secretRecordID {
      guard let secret else { return nil }
      let record = CKRecord(recordType: Self.secretRecordType, recordID: recordID)
      record.encryptedValues[Self.secretKey] = secret
      return record
    }
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
    if record.recordID == Self.secretRecordID {
      adoptSecret(from: record)
      return
    }
    guard let url = (record[Self.fileKey] as? CKAsset)?.fileURL,
      let data = try? Data(contentsOf: url)
    else { return }
    do {
      if let id = try library.receive(data) { onRideFromAnotherDevice?(id) }
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
        engine.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: Self.zoneID))])
        engine.state.add(
          pendingRecordZoneChanges: [.saveRecord(recordID), .saveRecord(Self.secretRecordID)])
      case .serverRecordChanged where recordID == Self.secretRecordID:
        adoptSecret(from: failure.error.serverRecord)
      case .serverRecordChanged:
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
      case .signOut, .switchAccounts: restartForAnotherAccount()
      @unknown default: break
      }
    case .fetchedRecordZoneChanges(let changes):
      for modification in changes.modifications { receive(modification.record) }
      for deletion in changes.deletions where deletion.recordID != Self.secretRecordID {
        library.removeReceived(deletion.recordID.recordName)
      }
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
          syncEngine.state.remove(pendingRecordZoneChanges: [.saveRecord(recordID)])
          return nil
        }
        return record
      }
    }
  }
}
