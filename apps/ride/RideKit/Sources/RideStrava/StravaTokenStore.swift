import Foundation
import Security

/// Where the sign-in is kept between launches.
public protocol StravaTokenStore: Sendable {
  func load() -> StravaTokens?
  /// Saves `tokens`, or forgets the sign-in with nil.
  func save(_ tokens: StravaTokens?)
}

/// Keeps the sign-in in the Keychain, so it stays out of backups of the app's files.
public struct KeychainStravaTokenStore: StravaTokenStore {
  private let service: String

  public init(service: String = "com.trainstackhq.ride.strava") {
    self.service = service
  }

  private var query: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: "tokens",
    ]
  }

  public func load() -> StravaTokens? {
    var query = query
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data
    else { return nil }
    return try? JSONDecoder().decode(StravaTokens.self, from: data)
  }

  public func save(_ tokens: StravaTokens?) {
    SecItemDelete(query as CFDictionary)
    guard let tokens, let data = try? JSONEncoder().encode(tokens) else { return }
    var item = query
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    SecItemAdd(item as CFDictionary, nil)
  }
}

/// Holds the sign-in in memory only, for previews and tests.
public final class InMemoryStravaTokenStore: StravaTokenStore, @unchecked Sendable {
  private let lock = NSLock()
  private var tokens: StravaTokens?

  public init(_ tokens: StravaTokens? = nil) {
    self.tokens = tokens
  }

  public func load() -> StravaTokens? { lock.withLock { tokens } }

  public func save(_ tokens: StravaTokens?) { lock.withLock { self.tokens = tokens } }
}
