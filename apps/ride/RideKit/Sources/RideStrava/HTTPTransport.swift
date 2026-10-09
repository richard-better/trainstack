import Foundation

/// Sends requests, so tests can stand in for the network.
public protocol HTTPTransport: Sendable {
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

extension URLSession: HTTPTransport {
  public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (data, response) = try await data(for: request)
    guard let response = response as? HTTPURLResponse else { throw StravaError.unavailable }
    return (data, response)
  }
}
