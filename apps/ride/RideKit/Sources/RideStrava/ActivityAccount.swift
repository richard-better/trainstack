public struct ActivityAccount: Equatable, Sendable {
  public let id: String
  let token: String

  public init(id: String, token: String) {
    self.id = id
    self.token = token
  }
}
