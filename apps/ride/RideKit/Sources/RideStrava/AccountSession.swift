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
    ]
  }

  public func load() async -> AccountSession? {
    // The read waits for the rider when macOS asks before sharing the item, so it gets a thread of
    // its own rather than holding one Swift concurrency needs.
    await withCheckedContinuation { continuation in
      DispatchQueue.global(qos: .userInitiated).async {
        continuation.resume(returning: read())
      }
    }
  }

  private func read() -> AccountSession? {
    var query = query
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data
    else { return nil }
    return try? JSONDecoder().decode(AccountSession.self, from: data)
  }

  public func save(_ session: AccountSession?) {
    SecItemDelete(query as CFDictionary)
    guard let session, let data = try? JSONEncoder().encode(session) else { return }
    var item = query
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    SecItemAdd(item as CFDictionary, nil)
  }
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
