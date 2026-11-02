import Foundation

public struct AccountSession: Codable, Equatable, Sendable {
  public var token: String
  public var name: String?

  public init(token: String, name: String? = nil) {
    self.token = token
    self.name = name
  }
}
