import Foundation

public struct APIError: LocalizedError, Sendable {
  public let message: String
  public let status: Int?
  public init(message: String, status: Int? = nil) {
    self.message = message
    self.status = status
  }
  public var errorDescription: String? { message }
}
