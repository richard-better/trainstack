public struct Endpoint<Response: Decodable & Sendable>: Sendable {
  public let path: String
  public init(_ path: String) { self.path = path }
}
