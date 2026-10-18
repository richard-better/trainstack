import Foundation
import Security

/// Which way Ride signs in with Apple.
public enum AppleSignIn {
  /// Whether this build holds the Sign in with Apple entitlement. Builds signed with Developer ID,
  /// such as the one Homebrew installs, cannot, so they sign in through Apple's web flow instead.
  public static let isNative: Bool = {
    #if os(macOS)
      guard let task = SecTaskCreateFromSelf(nil) else { return false }
      return allowsNativeSignIn(
        SecTaskCopyValueForEntitlement(task, "com.apple.developer.applesignin" as CFString, nil))
    #else
      return true
    #endif
  }()

  /// Whether `entitlement`, the value of `com.apple.developer.applesignin`, turns it on.
  static func allowsNativeSignIn(_ entitlement: Any?) -> Bool {
    (entitlement as? [String])?.contains("Default") == true
  }
}
