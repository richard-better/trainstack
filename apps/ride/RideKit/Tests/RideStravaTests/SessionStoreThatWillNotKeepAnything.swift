import Security

@testable import RideStrava

final class SessionStoreThatWillNotKeepAnything: SessionStore {
  func load() async -> AccountSession? { nil }
  func save(_ session: AccountSession?) throws {
    throw SessionStoreError(status: errSecMissingEntitlement)
  }
}
