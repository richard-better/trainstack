import Foundation
import Security

/// A signed-in TrainStack account, as kept on the device.
public struct AccountSession: Codable, Equatable, Sendable {
  /// Sent as a bearer token with every request the account makes.
  public var token: String
  /// What to call the rider, for Settings.
  public var name: String?

  public init(token: String, name: String? = nil) {
    self.token = token
    self.name = name
  }
}

/// Where the session is kept between launches.
public protocol SessionStore: Sendable {
  /// Reads the kept session. It can take as long as the rider takes to answer a Keychain prompt,
  /// so it is never read on the main actor.
  func load() async -> AccountSession?
  /// Saves `session`, or forgets it with nil.
  func save(_ session: AccountSession?)
}

/// Keeps the session in the Keychain, so it stays out of backups of the app's files.
///
/// On the Mac it uses the data protection keychain, as iOS does, which keeps the item to the app's
/// own access group without asking the rider. Builds before it kept the session in the login
/// keychain, which asks first whenever the build reading the item is signed differently from the
/// one that saved it; the first read moves the session across.
public struct KeychainSessionStore: SessionStore {
  private let service: String

  public init(service: String = "com.trainstackhq.ride.account") {
    self.service = service
  }

  private var query: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: "session",
      kSecUseDataProtectionKeychain as String: true,
    ]
  }

  public func load() async -> AccountSession? {
    // Moving a session out of the login keychain can wait for the rider to answer a prompt, so the
    // read gets a thread of its own rather than holding one Swift concurrency needs.
    await withCheckedContinuation { continuation in
      DispatchQueue.global(qos: .userInitiated).async {
        continuation.resume(returning: read())
      }
    }
  }

  private func read() -> AccountSession? {
    if let data = Self.data(matching: query) {
      return try? JSONDecoder().decode(AccountSession.self, from: data)
    }
    #if os(macOS)
      return moveFromLoginKeychain()
    #else
      return nil
    #endif
  }

  public func save(_ session: AccountSession?) {
    SecItemDelete(query as CFDictionary)
    guard let session, let data = try? JSONEncoder().encode(session) else { return }
    add(data)
  }

  @discardableResult private func add(_ data: Data) -> Bool {
    var item = query
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
  }

  private static func data(matching query: [String: Any]) -> Data? {
    var query = query
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
    return result as? Data
  }

  #if os(macOS)
    /// Moves a session saved in the login keychain to the data protection keychain.
    private func moveFromLoginKeychain() -> AccountSession? {
      // Only a build with an application identifier from its provisioning profile can keep items
      // in the data protection keychain. One without, like an unsigned development build, would
      // ask the rider for an item it cannot move, so it starts signed out instead.
      guard Self.hasApplicationIdentifier else { return nil }
      var legacy = query
      legacy[kSecUseDataProtectionKeychain as String] = false
      guard let data = Self.data(matching: legacy),
        let session = try? JSONDecoder().decode(AccountSession.self, from: data)
      else { return nil }
      if add(data) { SecItemDelete(legacy as CFDictionary) }
      return session
    }

    private static let hasApplicationIdentifier: Bool = {
      guard let task = SecTaskCreateFromSelf(nil) else { return false }
      return SecTaskCopyValueForEntitlement(
        task, "com.apple.application-identifier" as CFString, nil) != nil
    }()
  #endif
}

/// Holds the session in memory only, for previews and tests.
public final class InMemorySessionStore: SessionStore, @unchecked Sendable {
  private let lock = NSLock()
  private var session: AccountSession?

  public init(_ session: AccountSession? = nil) {
    self.session = session
  }

  public func load() async -> AccountSession? { lock.withLock { session } }

  public func save(_ session: AccountSession?) { lock.withLock { self.session = session } }
}
