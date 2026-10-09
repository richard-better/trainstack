import CryptoKit
import Foundation
import Security

/// Talks to the TrainStack API for the rider's account: signing in with Apple, connecting Strava,
/// and sending rides there. The API holds Strava's tokens, so nothing secret is kept here but the
/// account's session token.
public actor TrainStackClient {
  public static let server = URL(string: "https://api.trainstackhq.com")!
  /// The scheme the API sends the rider back to once Strava is connected.
  public static let callbackScheme = "trainstackride"

  private let server: URL
  private let store: any SessionStore
  private let transport: any HTTPTransport
  private let pollInterval: Duration
  private let pollLimit: Int
  private var session: AccountSession?

  public init(
    server: URL = TrainStackClient.server, store: any SessionStore = KeychainSessionStore(),
    transport: any HTTPTransport = URLSession.shared,
    pollInterval: Duration = .seconds(3), pollLimit: Int = 15
  ) {
    self.server = server
    self.store = store
    self.transport = transport
    self.pollInterval = pollInterval
    self.pollLimit = pollLimit
    session = store.load()
  }

  public var accountName: String? { session?.name }
  public var isSignedIn: Bool { session != nil }

  // MARK: Account

  /// Signs in with the identity token Apple gave the app. `nonce` is the unhashed one whose
  /// SHA-256 went to Apple, and `fullName` is what Apple shares the first time only.
  public func signInWithApple(
    identityToken: String, nonce: String, fullName: String?
  ) async throws {
    let body: [String: Any] = [
      "provider": "apple", "idToken": ["token": identityToken, "nonce": nonce],
    ]
    let (data, response) = try await send("POST", "api/auth/sign-in/social", json: body)
    guard response.statusCode == 200 else {
      throw response.statusCode < 500 ? StravaError.signInFailed : StravaError.unavailable
    }
    struct SignedIn: Decodable {
      struct User: Decodable { let name: String? }
      let token: String?
      let user: User?
    }
    let signedIn = try? Self.decoder.decode(SignedIn.self, from: data)
    guard let token = response.value(forHTTPHeaderField: "set-auth-token") ?? signedIn?.token else {
      throw StravaError.signInFailed
    }
    var name = signedIn?.user?.name.flatMap { $0.isEmpty ? nil : $0 }
    save(AccountSession(token: token, name: name))

    // Apple shares the name once, with the app and not in the token, so give it to the account.
    if name == nil, let fullName, !fullName.isEmpty {
      if (try? await send("POST", "api/auth/update-user", json: ["name": fullName], signedIn: true))?
        .1.statusCode == 200
      {
        name = fullName
        save(AccountSession(token: token, name: name))
      }
    }
  }

  /// Signs out of this device. The session ends on the server too when it can be reached.
  public func signOut() async {
    _ = try? await send("POST", "api/auth/sign-out", json: [:], signedIn: true)
    save(nil)
  }

  /// Deletes the account and everything stored for it, including the Strava connection.
  public func deleteAccount() async throws {
    let (_, response) = try await send("POST", "api/auth/delete-user", json: [:], signedIn: true)
    switch response.statusCode {
    case 200: save(nil)
    case 400: throw StravaError.rejected("Sign in again, then delete the account.")
    default: throw StravaError.unavailable
    }
  }

  private func save(_ session: AccountSession?) {
    self.session = session
    store.save(session)
  }

  // MARK: Strava

  public func stravaStatus() async throws -> StravaStatus {
    let (data, response) = try await send("GET", "strava", signedIn: true)
    try check(response, data)
    return try Self.status(from: data)
  }

  private static func status(from data: Data) throws -> StravaStatus {
    struct Status: Decodable {
      let connected: Bool
      let athleteName: String?
    }
    guard let status = try? decoder.decode(Status.self, from: data) else {
      throw StravaError.unavailable
    }
    return StravaStatus(isConnected: status.connected, athleteName: status.athleteName)
  }

  /// Connecting Strava: the address to show the rider so they can allow Ride to upload, and the
  /// secret that proves the app that asked is the one that collects the result.
  public struct ConnectAttempt: Sendable {
    public let url: URL
    let verifier: String
  }

  public func startStravaConnection() async throws -> ConnectAttempt {
    var bytes = [UInt8](repeating: 0, count: 48)
    if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) != errSecSuccess {
      bytes = bytes.map { _ in UInt8.random(in: .min ... .max) }
    }
    let verifier = Self.base64URL(Data(bytes))
    let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    let (data, response) = try await send(
      "POST", "strava/connect", json: ["code_challenge": challenge], signedIn: true)
    try check(response, data)
    struct Connect: Decodable { let url: URL }
    guard let connect = try? Self.decoder.decode(Connect.self, from: data) else {
      throw StravaError.unavailable
    }
    return ConnectAttempt(url: connect.url, verifier: verifier)
  }

  /// Finishes connecting once the web session has come back to the app: `callback` is the address
  /// it ended at, which says whether Strava agreed.
  public func finishStravaConnection(
    _ attempt: ConnectAttempt, callback: URL
  ) async throws -> StravaStatus {
    try Self.checkConnectCallback(callback)
    let (data, response) = try await send(
      "POST", "strava/connect/complete", json: ["code_verifier": attempt.verifier],
      signedIn: true)
    if response.statusCode == 400 { throw StravaError.connectFailed }
    try check(response, data)
    return try Self.status(from: data)
  }

  /// Whether the address the rider ended up at means Strava agreed.
  static func checkConnectCallback(_ callback: URL) throws {
    let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
    func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
    switch (value("connected"), value("error")) {
    case ("1", nil): return
    case (_, "access_denied"?): throw StravaError.cancelled
    case (_, "insufficient_scope"?): throw StravaError.missingPermission
    case (_, "strava_not_configured"?): throw StravaError.notConfigured
    default: throw StravaError.connectFailed
    }
  }

  private static func base64URL(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  public func disconnectStrava() async throws {
    let (data, response) = try await send("DELETE", "strava", signedIn: true)
    try check(response, data)
  }

  // MARK: Uploading

  /// Sends a ride's FIT file to Strava as an indoor trainer ride, and waits for Strava to make an
  /// activity of it.
  public func upload(_ fit: Data, name: String, fileName: String) async throws -> StravaUpload {
    let query = [
      URLQueryItem(name: "name", value: name), URLQueryItem(name: "fileName", value: fileName),
    ]
    let (data, response) = try await send(
      "POST", "strava/uploads", query: query, body: fit, contentType: "application/octet-stream",
      signedIn: true)
    // A file Strava turns down comes back as 400 with the reason.
    if response.statusCode != 400 { try check(response, data) }
    var report = try Self.report(from: data)
    if let result = try Self.finished(report) { return result }

    guard let id = report.id else { throw StravaError.unavailable }
    for _ in 0..<pollLimit {
      try await Task.sleep(for: pollInterval)
      let (data, response) = try await send("GET", "strava/uploads/\(id)", signedIn: true)
      try check(response, data)
      report = try Self.report(from: data)
      if let result = try Self.finished(report) { return result }
    }
    throw StravaError.stillProcessing
  }

  private struct UploadReport: Decodable {
    let id: Int?
    let status: String
    let activityId: Int?
    let error: String?
    let duplicateOf: Int?
  }

  private static func report(from data: Data) throws -> UploadReport {
    guard let report = try? decoder.decode(UploadReport.self, from: data) else {
      throw StravaError.unavailable
    }
    return report
  }

  private static func finished(_ report: UploadReport) throws -> StravaUpload? {
    switch report.status {
    case "ready":
      guard let activityID = report.activityId else { throw StravaError.unavailable }
      return StravaUpload(activityID: activityID)
    case "error":
      if report.duplicateOf != nil
        || report.error?.localizedCaseInsensitiveContains("duplicate") == true
      {
        throw StravaError.duplicate(activityID: report.duplicateOf)
      }
      throw StravaError.rejected(report.error ?? "Strava turned the file down.")
    default:
      return nil
    }
  }

  // MARK: Requests

  /// Turns what the API answered into an error if it was one. A session the server no longer
  /// accepts ends the sign-in.
  private func check(_ response: HTTPURLResponse, _ data: Data) throws {
    switch response.statusCode {
    case 200..<300: return
    case 401:
      save(nil)
      throw StravaError.signedOut
    case 409: throw StravaError.notConnected
    case 413: throw StravaError.rejected("The ride is too large to upload.")
    case 429: throw StravaError.rateLimited
    case 503
    where (try? Self.decoder.decode([String: String].self, from: data))?["error"]
      == "strava_not_configured":
      throw StravaError.notConfigured
    default: throw StravaError.unavailable
    }
  }

  private func send(
    _ method: String, _ path: String, query: [URLQueryItem] = [], json: [String: Any]? = nil,
    body: Data? = nil, contentType: String? = nil, signedIn: Bool = false
  ) async throws -> (Data, HTTPURLResponse) {
    var components = URLComponents(
      url: server.appending(path: path), resolvingAgainstBaseURL: false)!
    if !query.isEmpty { components.queryItems = query }
    var request = URLRequest(url: components.url!)
    request.httpMethod = method
    if signedIn {
      guard let session else { throw StravaError.signedOut }
      request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
    }
    if let json {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONSerialization.data(withJSONObject: json)
    } else if let body {
      request.setValue(contentType, forHTTPHeaderField: "Content-Type")
      request.httpBody = body
    }
    do {
      return try await transport.send(request)
    } catch is CancellationError {
      throw CancellationError()
    } catch {
      throw StravaError.unavailable
    }
  }

  private static let decoder: JSONDecoder = {
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    return decoder
  }()
}
