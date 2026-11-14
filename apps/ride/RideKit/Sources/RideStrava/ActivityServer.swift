import Foundation

public protocol ActivityServer: Sendable {
  func signedInAccount() async throws -> ActivityAccount?
  func activities(for account: ActivityAccount) async throws -> [AccountActivity]
  func activityDetail(_ id: String, for account: ActivityAccount) async throws
    -> AccountActivityDetail
  func activityFile(_ id: String, for account: ActivityAccount) async throws -> Data
  func upload(_ file: ActivityFile, for account: ActivityAccount) async throws
    -> ActivityUploadResult
  func restore(_ file: ActivityFile, for account: ActivityAccount) async throws
    -> ActivityUploadResult
  func deleteActivity(_ id: String, for account: ActivityAccount) async throws
}
