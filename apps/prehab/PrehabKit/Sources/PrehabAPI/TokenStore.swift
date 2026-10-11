import Foundation
import Security

public enum TokenStore {
  public static func read(server: String) throws -> String? {
    var query = base(server)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else {
      throw APIError(message: "Could not read the saved sign-in (\(status)).")
    }
    return String(data: data, encoding: .utf8)
  }
  public static func write(_ token: String?, server: String) throws {
    let query = base(server)
    let deleted = SecItemDelete(query as CFDictionary)
    guard deleted == errSecSuccess || deleted == errSecItemNotFound else {
      throw APIError(message: "Could not clear the saved sign-in (\(deleted)).")
    }
    guard let token else { return }
    var item = query
    item[kSecValueData as String] = Data(token.utf8)
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(item as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw APIError(message: "Could not save the sign-in (\(status)).")
    }
  }
  private static func base(_ server: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "com.trainstack.prehab", kSecAttrAccount as String: server,
    ]
  }
}
