import Testing

@testable import RideLintRules

struct KeychainStaysInItsStoreTests {
  @Test func allowsKeychainCallsInTheStore() {
    let source = """
      public struct KeychainSessionStore {
        func save() { SecItemAdd(query, nil) }
      }
      extension KeychainSessionStore {
        func clear() { SecItemDelete(query) }
      }
      """
    #expect(violations(of: KeychainStaysInItsStore(), in: source).isEmpty)
  }

  @Test func flagsKeychainCallsAnywhereElse() {
    let source = """
      struct TrainStackAccount {
        init() { SecItemCopyMatching(query, &result) }
      }
      func load() { SecItemCopyMatching(query, &result) }
      """
    #expect(lines(violations(of: KeychainStaysInItsStore(), in: source)) == [2, 4])
  }
}
