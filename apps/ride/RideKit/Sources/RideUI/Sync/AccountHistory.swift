import Foundation
import Observation
import RideStrava
import os

@Observable
final class AccountHistory {
  private(set) var account: String?
  private(set) var activities: [AccountActivity] = []
  private(set) var details: [AccountActivity.ID: AccountActivityDetail] = [:]
  @ObservationIgnored private let server: any ActivityServer
  @ObservationIgnored private let directory: URL
  @ObservationIgnored private let cache: URL
  @ObservationIgnored let cacheLimit: Int
  @ObservationIgnored private var downloads: [AccountActivity.ID: Task<Data, any Error>] = [:]
  @ObservationIgnored private let log = Logger(
    subsystem: "com.trainstackhq.ride", category: "account-history")

  static let defaultCacheLimit = 100_000_000

  init(
    server: any ActivityServer, directory: URL = defaultDirectory, cache: URL = defaultCache,
    cacheLimit: Int = defaultCacheLimit
  ) {
    self.server = server
    self.directory = directory
    self.cache = cache
    self.cacheLimit = cacheLimit
    if let state = (try? Data(contentsOf: stateURL))
      .flatMap({ try? JSONDecoder().decode(AccountHistoryState.self, from: $0) })
    {
      account = state.account
      activities = state.activities
    }
  }

  static var defaultDirectory: URL {
    URL.applicationSupportDirectory.appending(path: "AccountHistory", directoryHint: .isDirectory)
  }

  static var defaultCache: URL {
    URL.cachesDirectory.appending(path: "AccountHistory", directoryHint: .isDirectory)
  }

  private var stateURL: URL { directory.appending(path: "History.json") }

  subscript(id: AccountActivity.ID?) -> AccountActivity? {
    id.flatMap { id in activities.first { $0.id == id } }
  }

  func show(_ account: String) {
    guard self.account != account else { return }
    forget()
    self.account = account
    save()
  }

  func forget() {
    for download in downloads.values { download.cancel() }
    downloads = [:]
    account = nil
    activities = []
    details = [:]
    try? FileManager.default.removeItem(at: directory)
    try? FileManager.default.removeItem(at: cache)
  }

  func receive(_ listing: [AccountActivity], for account: String) {
    guard self.account == account else { return }
    let kept = Dictionary(listing.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    for known in activities where kept[known.id] != known {
      if kept[known.id] == nil { removeCached(known.id) } else { forgetDetail(of: known.id) }
    }
    guard listing != activities else { return }
    activities = listing
    save()
  }

  func remove(_ id: AccountActivity.ID) {
    guard self[id] != nil else { return }
    activities.removeAll { $0.id == id }
    removeCached(id)
    save()
  }

  func file(of id: AccountActivity.ID) -> Data? {
    let url = fileURL(of: id)
    guard let data = try? Data(contentsOf: url) else { return nil }
    try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
    return data
  }

  func download(_ id: AccountActivity.ID) async throws -> Data {
    if let data = file(of: id) { return data }
    if let running = downloads[id] { return try await running.value }
    let task = Task { try await fetchFile(id) }
    downloads[id] = task
    defer { if downloads[id] == task { downloads[id] = nil } }
    return try await task.value
  }

  private func fetchFile(_ id: AccountActivity.ID) async throws -> Data {
    let account = try await currentAccount()
    let data = try await server.activityFile(id, for: account)
    try check(account, stillHas: id)
    write(data, to: fileURL(of: id))
    trimCache(keeping: id)
    return data
  }

  func detail(of id: AccountActivity.ID) -> AccountActivityDetail? {
    if let detail = details[id] { return detail }
    let detail = (try? Data(contentsOf: detailURL(of: id)))
      .flatMap { try? JSONDecoder().decode(AccountActivityDetail.self, from: $0) }
    if let detail { details[id] = detail }
    return detail
  }

  @discardableResult
  func loadDetail(of id: AccountActivity.ID) async throws -> AccountActivityDetail {
    let account = try await currentAccount()
    let detail = try await server.activityDetail(id, for: account)
    try check(account, stillHas: id)
    details[id] = detail
    if let data = try? JSONEncoder().encode(detail) { write(data, to: detailURL(of: id)) }
    return detail
  }

  func loadDetailIfNeeded(of activity: AccountActivity, forLaps: Bool = false) async {
    guard activity.indoor != true || forLaps, detail(of: activity.id) == nil else { return }
    _ = try? await loadDetail(of: activity.id)
  }

  private func currentAccount() async throws -> ActivityAccount {
    guard let account = try await server.signedInAccount(), account.id == self.account else {
      throw StravaError.signedOut
    }
    return account
  }

  private func check(_ account: ActivityAccount, stillHas id: AccountActivity.ID) throws {
    try Task.checkCancellation()
    guard self.account == account.id, self[id] != nil else { throw CancellationError() }
  }

  private func cacheName(of id: AccountActivity.ID) -> String {
    id.filter { $0.isLetter || $0.isNumber }
  }

  private func fileURL(of id: AccountActivity.ID) -> URL {
    cache.appending(path: "\(cacheName(of: id)).file")
  }

  private func detailURL(of id: AccountActivity.ID) -> URL {
    cache.appending(path: "\(cacheName(of: id)).detail.json")
  }

  private func removeCached(_ id: AccountActivity.ID) {
    downloads.removeValue(forKey: id)?.cancel()
    try? FileManager.default.removeItem(at: fileURL(of: id))
    forgetDetail(of: id)
  }

  private func forgetDetail(of id: AccountActivity.ID) {
    details[id] = nil
    try? FileManager.default.removeItem(at: detailURL(of: id))
  }

  var cachedFileBytes: Int { cachedFiles().reduce(0) { $0 + $1.size } }

  private func cachedFiles() -> [(url: URL, size: Int, used: Date)] {
    let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
    let urls =
      (try? FileManager.default.contentsOfDirectory(
        at: cache, includingPropertiesForKeys: keys)) ?? []
    return urls.filter { $0.pathExtension == "file" }.compactMap { url in
      guard let values = try? url.resourceValues(forKeys: Set(keys)) else { return nil }
      return (url, values.fileSize ?? 0, values.contentModificationDate ?? .distantPast)
    }
  }

  private func trimCache(keeping id: AccountActivity.ID) {
    let kept = fileURL(of: id).standardizedFileURL
    var files = cachedFiles().sorted { $0.used < $1.used }
    var total = files.reduce(0) { $0 + $1.size }
    while total > cacheLimit, let oldest = files.first {
      files.removeFirst()
      guard oldest.url.standardizedFileURL != kept else { continue }
      try? FileManager.default.removeItem(at: oldest.url)
      total -= oldest.size
    }
  }

  private func save() {
    guard let account else { return }
    guard
      let data = try? JSONEncoder().encode(
        AccountHistoryState(account: account, activities: activities))
    else { return }
    write(data, to: stateURL)
  }

  private func write(_ data: Data, to url: URL) {
    do {
      try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try data.write(to: url, options: .atomic)
    } catch {
      log.error("Account history not saved: \(error.localizedDescription)")
    }
  }
}
