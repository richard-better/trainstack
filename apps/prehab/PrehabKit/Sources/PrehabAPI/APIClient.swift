import Foundation
import PrehabCore

public actor APIClient {
  public let baseURL: URL
  private let session: URLSession
  private let analytics = Analytics()
  private var analyticsRevision = 0
  private var token: String?

  public init(baseURL: URL, token: String? = nil, session: URLSession = .shared) {
    self.baseURL = baseURL
    self.token = token
    self.session = session
  }
  public func setAnalytics(enabled: Bool) async {
    analyticsRevision += 1
    let revision = analyticsRevision
    let config = enabled ? (try? await configuration())?["posthog"] : nil
    guard revision == analyticsRevision else { return }
    await analytics.configure(config ?? .null)
  }
  public func setToken(_ token: String?) { self.token = token }
  public func call<T>(_ endpoint: Endpoint<T>, _ input: [String: JSONValue] = [:]) async throws -> T
  {
    let data = try await request(
      path: "rpc/" + endpoint.path, body: .object(["json": .object(input)]))
    let result = try JSONDecoder().decode(RPCEnvelope<T>.self, from: data).json
    Task { await analytics.capture("operation_completed", operation: endpoint.path) }
    return result
  }
  public func configuration() async throws -> JSONValue {
    try JSONDecoder().decode(
      JSONValue.self, from: await request(path: "app.json", body: nil, method: "GET"))
  }
  public func auth(path: String, body: [String: JSONValue]? = nil) async throws -> JSONValue {
    let data = try await request(
      path: "api/auth/" + path, body: body.map(JSONValue.object),
      method: body == nil ? "GET" : "POST")
    return try JSONDecoder().decode(JSONValue.self, from: data)
  }
  public func sendCoach(threadID: String, messageID: String, text: String) async throws {
    let body: JSONValue = .object([
      "threadId": .string(threadID),
      "messages": .array([
        .object([
          "id": .string(messageID), "role": .string("user"),
          "parts": .array([.object(["type": .string("text"), "text": .string(text)])]),
        ])
      ]),
    ])
    let data = try await request(path: "api/coach/stream", body: body)
    let stream = String(decoding: data, as: UTF8.self)
    for line in stream.components(separatedBy: .newlines) where line.hasPrefix("data: ") {
      guard
        let event = try? JSONDecoder().decode(JSONValue.self, from: Data(line.dropFirst(6).utf8))
      else { continue }
      if event["type"].string == "error" {
        throw APIError(
          message: event["errorText"].string ?? "Coach could not respond. Please retry.")
      }
    }
  }
  private func request(path: String, body: JSONValue?, method: String = "POST") async throws -> Data
  {
    var request = URLRequest(url: baseURL.appending(path: path))
    request.httpMethod = method
    request.timeoutInterval = 120
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    request.httpBody = try body.map { try JSONEncoder().encode($0) }
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw APIError(message: "The server returned an invalid response.")
    }
    guard (200..<300).contains(http.statusCode) else {
      let value = try? JSONDecoder().decode(JSONValue.self, from: data)
      throw APIError(
        message: value?["json"]["message"].string ?? value?["message"].string ?? value?["error"]
          .string ?? "Request failed (\(http.statusCode)).", status: http.statusCode)
    }
    return data
  }
}
