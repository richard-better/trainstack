import Foundation

public enum FeedbackError: Error, Equatable, Sendable {
  case appleAccountRequired
  case dailyLimitReached
  case notConfigured
}

extension FeedbackError: LocalizedError {
  public var errorDescription: String? {
    switch self {
    case .appleAccountRequired: "Sign in with Apple to send feedback."
    case .dailyLimitReached: "You've sent a lot of feedback today. Thank you! Try again tomorrow."
    case .notConfigured: "Feedback isn't set up on the server yet."
    }
  }
}
