public protocol SessionStore: Sendable {
  func load() async -> AccountSession?
  func save(_ session: AccountSession?) throws
}
