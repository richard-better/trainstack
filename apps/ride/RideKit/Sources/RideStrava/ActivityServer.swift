public protocol ActivityServer: Sendable {
  func signedInAccount() async throws -> ActivityAccount?
  func activityIDs(for account: ActivityAccount) async throws -> Set<String>
  func upload(_ file: ActivityFile, for account: ActivityAccount) async throws
    -> ActivityUploadResult
  func deleteActivity(_ id: String, for account: ActivityAccount) async throws
}
