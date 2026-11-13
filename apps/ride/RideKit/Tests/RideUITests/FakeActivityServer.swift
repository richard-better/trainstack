import Foundation
import RideData
import RideStrava

@testable import RideUI

actor FakeActivityServer: ActivityServer {
  enum Call: Equatable {
    case list(account: String)
    case upload(String, account: String)
    case delete(String, account: String)
  }

  private(set) var calls: [Call] = []
  private var activities: [String: Set<String>] = [:]
  private var tombstones: [String: Set<String>] = [:]
  private var signedIn: ActivityAccount?
  private var offline = false

  init(signedInAs account: String? = "ada") {
    signedIn = account.map { ActivityAccount(id: $0, token: "token-\($0)") }
  }

  func signIn(as account: String?) {
    signedIn = account.map { ActivityAccount(id: $0, token: "token-\($0)") }
  }

  func goOffline(_ offline: Bool = true) { self.offline = offline }

  func store(_ id: String, for account: String) { activities[account, default: []].insert(id) }

  func deleteElsewhere(_ id: String, for account: String) {
    activities[account, default: []].remove(id)
    tombstones[account, default: []].insert(id)
  }

  func activities(of account: String) -> Set<String> { activities[account] ?? [] }

  func tombstones(of account: String) -> Set<String> { tombstones[account] ?? [] }

  var uploads: [String] {
    calls.compactMap { if case .upload(let id, _) = $0 { id } else { nil } }
  }

  var deletions: [Call] {
    calls.filter { if case .delete = $0 { true } else { false } }
  }

  func signedInAccount() async throws -> ActivityAccount? {
    if offline, signedIn != nil { throw StravaError.unavailable }
    return signedIn
  }

  private func check(_ account: ActivityAccount) throws {
    guard signedIn == account else { throw StravaError.signedOut }
    if offline { throw StravaError.unavailable }
  }

  func activityIDs(for account: ActivityAccount) async throws -> Set<String> {
    try check(account)
    calls.append(.list(account: account.id))
    return activities(of: account.id)
  }

  func upload(_ file: ActivityFile, for account: ActivityAccount) async throws
    -> ActivityUploadResult
  {
    try check(account)
    let id = Ride(recording: try FITDecoder.decode(file.data), fileData: file.data).id
    calls.append(.upload(id, account: account.id))
    if tombstones(of: account.id).contains(id) { return .deletedOnTheServer }
    store(id, for: account.id)
    return .stored
  }

  func deleteActivity(_ id: String, for account: ActivityAccount) async throws {
    try check(account)
    calls.append(.delete(id, account: account.id))
    deleteElsewhere(id, for: account.id)
  }
}
