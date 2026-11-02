import Foundation

public struct FeedbackIssue: Equatable, Sendable {
  public let number: Int
  public let url: URL

  public init(number: Int, url: URL) {
    self.number = number
    self.url = url
  }
}
