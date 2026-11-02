import Foundation
import Security
import Synchronization
import Testing

@testable import RideStrava

private final class FakeKeychain: KeychainSessionStore.Items {
  private struct State {
    var items: [KeychainSessionStore.Keychain: Data] = [:]
    var reads: [KeychainSessionStore.Keychain] = []
  }

  let canMoveItemsOutOfLoginKeychain: Bool
  private let acceptsDataProtectionItems: Bool
  private let state = Mutex(State())

  init(
    dataProtection: AccountSession? = nil, login: AccountSession? = nil,
    canMoveItemsOutOfLoginKeychain: Bool = true, acceptsDataProtectionItems: Bool = true
  ) {
    self.canMoveItemsOutOfLoginKeychain = canMoveItemsOutOfLoginKeychain
    self.acceptsDataProtectionItems = acceptsDataProtectionItems
    state.withLock {
      $0.items[.dataProtection] = dataProtection.flatMap { try? JSONEncoder().encode($0) }
      $0.items[.login] = login.flatMap { try? JSONEncoder().encode($0) }
    }
  }

  func session(in keychain: KeychainSessionStore.Keychain) -> AccountSession? {
    state.withLock { $0.items[keychain] }.flatMap {
      try? JSONDecoder().decode(AccountSession.self, from: $0)
    }
  }

  var reads: [KeychainSessionStore.Keychain] { state.withLock { $0.reads } }

  func data(in keychain: KeychainSessionStore.Keychain) -> Data? {
    state.withLock {
      $0.reads.append(keychain)
      return $0.items[keychain]
    }
  }

  func add(_ data: Data, to keychain: KeychainSessionStore.Keychain) -> OSStatus {
    guard keychain == .login || acceptsDataProtectionItems else { return errSecMissingEntitlement }
    return state.withLock {
      guard $0.items[keychain] == nil else { return errSecDuplicateItem }
      $0.items[keychain] = data
      return errSecSuccess
    }
  }

  func delete(from keychain: KeychainSessionStore.Keychain) -> OSStatus {
    state.withLock {
      $0.items.removeValue(forKey: keychain) == nil ? errSecItemNotFound : errSecSuccess
    }
  }
}

struct KeychainSessionStoreTests {
  private let old = AccountSession(token: "login-token", name: "Ada Rider")
  private let current = AccountSession(token: "current-token", name: "Ada Rider")

  @Test func keepsTheSessionInTheDataProtectionKeychain() async throws {
    let keychain = FakeKeychain()
    let store = KeychainSessionStore(items: keychain)
    try store.save(current)
    #expect(keychain.session(in: .dataProtection) == current)
    #expect(await store.load() == current)
    try store.save(nil)
    #expect(await store.load() == nil)
  }

  @Test func prefersTheDataProtectionKeychainOverTheLoginKeychain() async {
    let keychain = FakeKeychain(dataProtection: current, login: old)
    #expect(await KeychainSessionStore(items: keychain).load() == current)
    #expect(keychain.reads == [.dataProtection])
  }

  @Test func movesASessionFromTheLoginKeychainIntoTheDataProtectionKeychain() async {
    let keychain = FakeKeychain(login: old)
    #expect(await KeychainSessionStore(items: keychain).load() == old)
    #expect(keychain.session(in: .dataProtection) == old)
    #expect(keychain.session(in: .login) == nil)
  }

  @Test func keepsTheLoginKeychainSessionWhenTheMoveFails() async {
    let keychain = FakeKeychain(login: old, acceptsDataProtectionItems: false)
    #expect(await KeychainSessionStore(items: keychain).load() == old)
    #expect(keychain.session(in: .login) == old)
  }

  @Test func startsSignedOutWithoutAskingForALoginKeychainSessionItCannotMove() async {
    let keychain = FakeKeychain(login: old, canMoveItemsOutOfLoginKeychain: false)
    #expect(await KeychainSessionStore(items: keychain).load() == nil)
    #expect(keychain.reads == [.dataProtection])
    #expect(keychain.session(in: .login) == old)
  }
}
