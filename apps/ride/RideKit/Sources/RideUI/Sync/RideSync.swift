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
  private static let deletedRideRecordType = "DeletedRide"
  private static let deletedRidePrefix = "deleted-"

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
  var beforeStoringRideFromAnotherDevice: (Ride) -> Void = { _ in }
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

  private var deletedRidesURL: URL {
    stateURL.deletingLastPathComponent().appending(path: "DeletedRides.json")
  }

  private lazy var deletedRides: Set<Ride.ID> = {
    guard let data = try? Data(contentsOf: deletedRidesURL) else { return [] }
    return (try? JSONDecoder().decode(Set<Ride.ID>.self, from: data)) ?? []
  }()

  @discardableResult
  private func rememberDeleted(_ id: Ride.ID) -> Bool {
    guard deletedRides.insert(id).inserted else { return false }
    do {
      try FileManager.default.createDirectory(
        at: deletedRidesURL.deletingLastPathComponent(), withIntermediateDirectories: true)
      try JSONEncoder().encode(deletedRides).write(to: deletedRidesURL, options: .atomic)
    } catch {
      log.error("Deleted rides not saved: \(error.localizedDescription)")
    }
    return true
  }

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
    deletedRides = []
    try? FileManager.default.removeItem(at: stateURL)
    try? FileManager.default.removeItem(at: secretURL)
    try? FileManager.default.removeItem(at: deletedRidesURL)
    start()
  }

  private func send(_ change: RideLibrary.Change) {
    engine?.state.add(pendingRecordZoneChanges: changes(toSendFor: change))
  }

  func changes(toSendFor change: RideLibrary.Change) -> [CKSyncEngine.PendingRecordZoneChange] {
    switch change {
    case .added(let id):
      return deletedRides.contains(id) ? [] : [.saveRecord(recordID(id))]
    case .removed(let id):
      rememberDeleted(id)
      return [.deleteRecord(recordID(id)), .saveRecord(deletedRecordID(id))]
    }
  }

  private func sendEverything(with engine: CKSyncEngine) {
    engine.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: Self.zoneID))])
    engine.state.add(pendingRecordZoneChanges: everythingToSend())
  }

  func everythingToSend() -> [CKSyncEngine.PendingRecordZoneChange] {
    [.saveRecord(Self.secretRecordID)]
      + library.rides.filter { !deletedRides.contains($0.id) }.map { .saveRecord(recordID($0.id)) }
      + deletedRides.sorted().map { .saveRecord(deletedRecordID($0)) }
  }

  func recordID(_ id: Ride.ID) -> CKRecord.ID {
    CKRecord.ID(recordName: id, zoneID: Self.zoneID)
  }

  func deletedRecordID(_ id: Ride.ID) -> CKRecord.ID {
    CKRecord.ID(recordName: Self.deletedRidePrefix + id, zoneID: Self.zoneID)
  }

  private func deletedRide(named recordName: String) -> Ride.ID? {
    guard recordName.hasPrefix(Self.deletedRidePrefix) else { return nil }
    return String(recordName.dropFirst(Self.deletedRidePrefix.count))
  }

  func record(for recordID: CKRecord.ID) -> CKRecord? {
    if let id = deletedRide(named: recordID.recordName) {
      guard deletedRides.contains(id) else { return nil }
      return CKRecord(recordType: Self.deletedRideRecordType, recordID: recordID)
    }
    if deletedRides.contains(recordID.recordName) { return nil }
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

  func receive(_ record: CKRecord) -> [CKSyncEngine.PendingRecordZoneChange] {
    if record.recordID == Self.secretRecordID {
      adoptSecret(from: record)
      return []
    }
    if let id = deletedRide(named: record.recordID.recordName) {
      if rememberDeleted(id) { library.removeReceived(id) }
      return [.deleteRecord(recordID(id))]
    }
    if deletedRides.contains(record.recordID.recordName) {
      return [.deleteRecord(record.recordID)]
    }
    guard let url = (record[Self.fileKey] as? CKAsset)?.fileURL,
      let data = try? Data(contentsOf: url)
    else { return [] }
    do {
      if let id = try library.receive(data, beforeStoring: beforeStoringRideFromAnotherDevice) {
        onRideFromAnotherDevice?(id)
      }
    } catch {
      log.error("Ride from iCloud not read: \(error.localizedDescription)")
    }
    return []
  }

  func receiveDeletion(of recordID: CKRecord.ID) {
    let name = recordID.recordName
    guard recordID != Self.secretRecordID, deletedRide(named: name) == nil,
      !deletedRides.contains(name)
    else { return }
    library.removeReceived(name)
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
        engine.state.add(pendingRecordZoneChanges: [.saveRecord(recordID)] + everythingToSend())
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
      for modification in changes.modifications {
        syncEngine.state.add(pendingRecordZoneChanges: receive(modification.record))
      }
      for deletion in changes.deletions { receiveDeletion(of: deletion.recordID) }
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
