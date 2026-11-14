import Foundation

public enum AppleAuthorizationError: Error, Equatable, Sendable {
  case invalidRequest
  case invalidCode
  case appleAccountRequired
  case anotherAppleID
  case appleUnavailable
  case appleNotConfigured
}
