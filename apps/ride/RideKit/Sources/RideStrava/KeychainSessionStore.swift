import Foundation
import Security

public struct KeychainSessionStore: SessionStore {
  enum Keychain: Sendable {
    case dataProtection
    case login
  }

  protocol Items: Sendable {
    var canMoveItemsOutOfLoginKeychain: Bool { get }
    func data(in keychain: Keychain) -> Data?
    func add(_ data: Data, to keychain: Keychain) -> OSStatus
    func delete(from keychain: Keychain) -> OSStatus
  }

  private let items: any Items

  public init(service: String = "com.trainstackhq.ride.account") {
    self.init(items: SystemItems(service: service))
  }

  init(items: any Items) {
    self.items = items
  }

  public func load() async -> AccountSession? {
    await Self.outsideTheCooperativePool { read() }
  }

  public func save(_ session: AccountSession?) throws {
    let deleted = items.delete(from: .dataProtection)
    guard deleted == errSecSuccess || deleted == errSecItemNotFound else {
      throw SessionStoreError(status: deleted)
    }
    guard let session else { return }
    let added = items.add(try JSONEncoder().encode(session), to: .dataProtection)
    guard added == errSecSuccess else { throw SessionStoreError(status: added) }
  }

  func read() -> AccountSession? {
    if let data = items.data(in: .dataProtection) {
      return try? JSONDecoder().decode(AccountSession.self, from: data)
    }
    return moveFromLoginKeychain()
  }

  private func moveFromLoginKeychain() -> AccountSession? {
    guard items.canMoveItemsOutOfLoginKeychain, let data = items.data(in: .login),
      let session = try? JSONDecoder().decode(AccountSession.self, from: data)
    else { return nil }
    if items.add(data, to: .dataProtection) == errSecSuccess { _ = items.delete(from: .login) }
    return session
  }

  private static func outsideTheCooperativePool<Result: Sendable>(
    _ work: @escaping @Sendable () -> Result
  ) async -> Result {
    await withCheckedContinuation { continuation in
      DispatchQueue.global(qos: .userInitiated).async {
        continuation.resume(returning: work())
      }
    }
  }
}

extension KeychainSessionStore {
  struct SystemItems: Items {
    let service: String

    var canMoveItemsOutOfLoginKeychain: Bool {
      #if os(macOS)
        Self.hasApplicationIdentifier
      #else
        false
      #endif
    }

    func data(in keychain: Keychain) -> Data? {
      var query = query(in: keychain)
      query[kSecReturnData as String] = true
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      var result: CFTypeRef?
      guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
      return result as? Data
    }

    func add(_ data: Data, to keychain: Keychain) -> OSStatus {
      var item = query(in: keychain)
      item[kSecValueData as String] = data
      item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
      return SecItemAdd(item as CFDictionary, nil)
    }

    func delete(from keychain: Keychain) -> OSStatus {
      SecItemDelete(query(in: keychain) as CFDictionary)
    }

    private func query(in keychain: Keychain) -> [String: Any] {
      [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: "session",
        kSecUseDataProtectionKeychain as String: keychain == .dataProtection,
      ]
    }

    #if os(macOS)
      private static let hasApplicationIdentifier: Bool = {
        guard let task = SecTaskCreateFromSelf(nil) else { return false }
        return SecTaskCopyValueForEntitlement(
          task, "com.apple.application-identifier" as CFString, nil) != nil
      }()
    #endif
  }
}
