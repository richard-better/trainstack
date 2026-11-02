import Foundation
import Security

public enum AppleSignIn {
  public static let isNative: Bool = {
    #if os(macOS)
      guard let task = SecTaskCreateFromSelf(nil) else { return false }
      return allowsNativeSignIn(
        SecTaskCopyValueForEntitlement(task, signInWithAppleEntitlement as CFString, nil))
    #else
      return true
    #endif
  }()

  static let signInWithAppleEntitlement = "com.apple.developer.applesignin"

  static func allowsNativeSignIn(_ signInWithAppleEntitlementValue: Any?) -> Bool {
    (signInWithAppleEntitlementValue as? [String])?.contains("Default") == true
  }
}
