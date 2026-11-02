public struct StravaStatus: Equatable, Sendable {
  public var isConnected: Bool
  public var athleteName: String?

  public init(isConnected: Bool, athleteName: String? = nil) {
    self.isConnected = isConnected
    self.athleteName = athleteName
  }
}
