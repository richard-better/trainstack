import Foundation

/// What Ride knows about where the rider was when they wrote feedback, sent along with it.
public struct FeedbackContext: Equatable, Sendable {
  /// The app's name, version and build, like `Ride 0.4 (57)`.
  public var app: String?
  /// Like `iOS 27.1`.
  public var system: String?
  /// The model identifier, like `iPhone18,1`.
  public var device: String?
  /// The part of the app they were looking at.
  public var screen: String?
  /// The window's size in points, like `1180×820`.
  public var window: String?

  public init(
    app: String? = nil, system: String? = nil, device: String? = nil, screen: String? = nil,
    window: String? = nil
  ) {
    self.app = app
    self.system = system
    self.device = device
    self.screen = screen
    self.window = window
  }

  var json: [String: String] {
    let fields = [
      "app": app, "system": system, "device": device, "screen": screen, "window": window,
    ]
    return fields.compactMapValues { $0 }
  }
}

/// The public GitHub issue a rider's feedback became.
public struct FeedbackIssue: Equatable, Sendable {
  public let number: Int
  public let url: URL

  public init(number: Int, url: URL) {
    self.number = number
    self.url = url
  }
}

public enum FeedbackError: Error, Equatable, Sendable {
  /// Only accounts made with Sign in with Apple can send feedback.
  case appleAccountRequired
  /// The account has sent all the feedback it can for today.
  case tooMuch
  /// The server has no GitHub account set up to file it.
  case notConfigured
}

extension FeedbackError: LocalizedError {
  public var errorDescription: String? {
    switch self {
    case .appleAccountRequired: "Sign in with Apple to send feedback."
    case .tooMuch: "You've sent a lot of feedback today. Thank you! Try again tomorrow."
    case .notConfigured: "Feedback isn't set up on the server yet."
    }
  }
}
