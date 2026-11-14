import Foundation
import RideData
import RideStrava

@testable import RideUI

actor FakeActivityServer: ActivityServer, HealthDayServer {
  enum Request { case list, upload, restore, file }

  enum Call: Equatable {
    case list(account: String)
    case upload(String, account: String)
    case restore(String, account: String)
    case delete(String, account: String)
    case detail(String, account: String)
    case file(String, account: String)
  }

  private(set) var calls: [Call] = []
  private(set) var files: [ActivityFile] = []
  private(set) var healthDayWrites: [(days: [MeasuredDay], stamp: SettingStamp, account: String)] =
    []
  private var activities: [String: Set<String>] = [:]
  private var tombstones: [String: Set<String>] = [:]
  private var listed: [String: AccountActivity] = [:]
  private var storedFiles: [String: Data] = [:]
  private var storedDetails: [String: AccountActivityDetail] = [:]
  private var signedIn: ActivityAccount?
  private var offline = false
  private var holding: Request?
  private var held: [CheckedContinuation<Void, Never>] = []

  init(signedInAs account: String? = "ada") {
    signedIn = account.map { ActivityAccount(id: $0, token: "token-\($0)") }
  }

  func signIn(as account: String?) {
    signedIn = account.map { ActivityAccount(id: $0, token: "token-\($0)") }
  }

  func goOffline(_ offline: Bool = true) { self.offline = offline }

  func holdReplies(to request: Request) { holding = request }

  var isHoldingAReply: Bool { !held.isEmpty }

  func releaseReplies() {
    holding = nil
    for continuation in held { continuation.resume() }
    held = []
  }

  private func replyWhenReleased(to request: Request) async {
    guard holding == request else { return }
    await withCheckedContinuation { held.append($0) }
  }

  func store(_ id: String, for account: String) { activities[account, default: []].insert(id) }

  func store(_ activity: AccountActivity, file: Data? = nil, for account: String) {
    store(activity.id, for: account)
    listed[activity.id] = activity
    storedFiles[activity.id] = file
  }

  func describeOnceStored(_ activity: AccountActivity) { listed[activity.id] = activity }

  func store(_ detail: AccountActivityDetail, of id: String) { storedDetails[id] = detail }

  var downloads: [String] {
    calls.compactMap { if case .file(let id, _) = $0 { id } else { nil } }
  }

  func deleteElsewhere(_ id: String, for account: String) {
    activities[account, default: []].remove(id)
    tombstones[account, default: []].insert(id)
  }

  func activities(of account: String) -> Set<String> { activities[account] ?? [] }

  func tombstones(of account: String) -> Set<String> { tombstones[account] ?? [] }

  var uploads: [String] {
    calls.compactMap { if case .upload(let id, _) = $0 { id } else { nil } }
  }

  var restores: [String] {
    calls.compactMap { if case .restore(let id, _) = $0 { id } else { nil } }
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

  func activities(for account: ActivityAccount) async throws -> [AccountActivity] {
    try check(account)
    calls.append(.list(account: account.id))
    let listing = activities(of: account.id).sorted().map { listed[$0] ?? AccountActivity(id: $0) }
    await replyWhenReleased(to: .list)
    return listing
  }

  func activityDetail(_ id: String, for account: ActivityAccount) async throws
    -> AccountActivityDetail
  {
    try check(account)
    calls.append(.detail(id, account: account.id))
    guard activities(of: account.id).contains(id) else { throw StravaError.unavailable }
    return storedDetails[id] ?? AccountActivityDetail()
  }

  func activityFile(_ id: String, for account: ActivityAccount) async throws -> Data {
    try check(account)
    calls.append(.file(id, account: account.id))
    guard activities(of: account.id).contains(id), let data = storedFiles[id] else {
      throw StravaError.unavailable
    }
    await replyWhenReleased(to: .file)
    return data
  }

  func upload(_ file: ActivityFile, for account: ActivityAccount) async throws
    -> ActivityUploadResult
  {
    try check(account)
    let id = Ride(recording: try FITDecoder.decode(file.data), fileData: file.data).id
    calls.append(.upload(id, account: account.id))
    files.append(file)
    let result: ActivityUploadResult =
      tombstones(of: account.id).contains(id) ? .deletedOnTheServer : .stored
    if result == .stored { store(id, for: account.id) }
    await replyWhenReleased(to: .upload)
    return result
  }

  func restore(_ file: ActivityFile, for account: ActivityAccount) async throws
    -> ActivityUploadResult
  {
    try check(account)
    let id = Ride(recording: try FITDecoder.decode(file.data), fileData: file.data).id
    calls.append(.restore(id, account: account.id))
    tombstones[account.id, default: []].remove(id)
    store(id, for: account.id)
    await replyWhenReleased(to: .restore)
    return .stored
  }

  func writeHealthDays(
    _ days: [MeasuredDay], at stamp: SettingStamp, for account: ActivityAccount
  ) async throws {
    try check(account)
    healthDayWrites.append((days, stamp, account.id))
  }

  func deleteActivity(_ id: String, for account: ActivityAccount) async throws {
    try check(account)
    calls.append(.delete(id, account: account.id))
    deleteElsewhere(id, for: account.id)
  }
}
