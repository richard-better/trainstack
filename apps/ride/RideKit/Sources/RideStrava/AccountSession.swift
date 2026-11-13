import Foundation

public struct AccountSession: Codable, Equatable, Sendable {
  public var token: String
  public var name: String?
  public var userID: String?

  public init(token: String, name: String? = nil, userID: String? = nil) {
    self.token = token
    self.name = name
    self.userID = userID
  }
}
