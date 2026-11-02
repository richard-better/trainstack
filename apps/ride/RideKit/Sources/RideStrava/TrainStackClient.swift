import CryptoKit
import Foundation
import Security

public actor TrainStackClient {
  public static let server = URL(string: "https://api.trainstackhq.com")!
  public static let callbackScheme = "trainstackride"

  private let server: URL
  private let store: any SessionStore
  private let transport: any HTTPTransport
  private let pollInterval: Duration
  private let pollLimit: Int
  private var session: AccountSession?
  private var keptSessionRead: Task<AccountSession?, Never>?
  private var knowsCurrentSession = false

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
  }

  public var accountName: String? {
    get async {
      await restore()
      return session?.name
    }
  }

  public var isSignedIn: Bool {
    get async {
      await restore()
      return session != nil
    }
  }

  private func restore() async {
    guard !knowsCurrentSession else { return }
    let task = keptSessionRead ?? Task { [store] in await store.load() }
    keptSessionRead = task
    let kept = await task.value
    guard !knowsCurrentSession else { return }
    session = kept
    knowsCurrentSession = true
    keptSessionRead = nil
  }

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
    let name = signedIn?.user?.name.flatMap { $0.isEmpty ? nil : $0 }
    try keep(AccountSession(token: token, name: name))
    if name == nil, let fullName, !fullName.isEmpty {
      await giveTheAccountTheNameAppleSharesOnce(fullName, token: token)
    }
  }

  private func giveTheAccountTheNameAppleSharesOnce(_ fullName: String, token: String) async {
    let updated = try? await send(
      "POST", "api/auth/update-user", json: ["name": fullName], signedIn: true)
    guard updated?.1.statusCode == 200 else { return }
    try? keep(AccountSession(token: token, name: fullName))
  }

  public struct WebSignInAttempt: Sendable {
    public let url: URL
    let verifier: String
  }

  public func startAppleWebSignIn() -> WebSignInAttempt {
    let (verifier, challenge) = Self.proofKey()
    var components = URLComponents(
      url: server.appending(path: "api/auth/app-handoff/apple"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "code_challenge", value: challenge)]
    return WebSignInAttempt(url: components.url!, verifier: verifier)
  }

  public func finishAppleWebSignIn(_ attempt: WebSignInAttempt, callback: URL) async throws {
    let code = try Self.signInCode(from: callback)
    let (data, response) = try await send(
      "POST", "api/auth/app-handoff/token",
      json: ["code": code, "code_verifier": attempt.verifier])
    switch response.statusCode {
    case 200: break
    case 429: throw StravaError.rateLimited
    case 400..<500: throw StravaError.signInFailed
    default: throw StravaError.unavailable
    }
    struct SignedIn: Decodable {
      struct User: Decodable { let name: String? }
      let token: String
      let user: User?
    }
    guard let signedIn = try? Self.decoder.decode(SignedIn.self, from: data) else {
      throw StravaError.signInFailed
    }
    let nameTheServerGotFromApple = signedIn.user?.name.flatMap { $0.isEmpty ? nil : $0 }
    try keep(AccountSession(token: signedIn.token, name: nameTheServerGotFromApple))
  }

  static func signInCode(from callback: URL) throws -> String {
    let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
    func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
    switch (value("code"), value("error")) {
    case (let code?, nil) where !code.isEmpty: return code
    case (_, "user_cancelled_authorize"?): throw StravaError.cancelled
    default: throw StravaError.signInFailed
    }
  }

  public func signOut() async {
    _ = try? await send("POST", "api/auth/sign-out", json: [:], signedIn: true)
    forget()
  }

  public func deleteAccount() async throws {
    let (_, response) = try await send("POST", "api/auth/delete-user", json: [:], signedIn: true)
    switch response.statusCode {
    case 200: forget()
    case 400: throw StravaError.rejected(reason: "Sign in again, then delete the account.")
    default: throw StravaError.unavailable
    }
  }

  private func keep(_ session: AccountSession) throws {
    do {
      try store.save(session)
    } catch {
      throw StravaError.sessionNotKept
    }
    self.session = session
    knowsCurrentSession = true
    keptSessionRead = nil
  }

  private func forget() {
    session = nil
    knowsCurrentSession = true
    keptSessionRead = nil
    try? store.save(nil)
  }

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

  public struct ConnectAttempt: Sendable {
    public let authorizationURL: URL
    let codeVerifier: String
  }

  public func startStravaConnection() async throws -> ConnectAttempt {
    let (verifier, challenge) = Self.proofKey()
    let (data, response) = try await send(
      "POST", "strava/connect", json: ["code_challenge": challenge], signedIn: true)
    if response.statusCode == 403 { throw StravaError.appleAccountRequired }
    try check(response, data)
    struct Connect: Decodable { let url: URL }
    guard let connect = try? Self.decoder.decode(Connect.self, from: data) else {
      throw StravaError.unavailable
    }
    return ConnectAttempt(authorizationURL: connect.url, codeVerifier: verifier)
  }

  public func finishStravaConnection(
    _ attempt: ConnectAttempt, callback: URL
  ) async throws -> StravaStatus {
    try Self.checkConnectCallback(callback)
    let (data, response) = try await send(
      "POST", "strava/connect/complete", json: ["code_verifier": attempt.codeVerifier],
      signedIn: true)
    if response.statusCode == 400 { throw StravaError.connectFailed }
    if response.statusCode == 409 { throw StravaError.athleteInUse }
    try check(response, data)
    return try Self.status(from: data)
  }

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

  static func proofKey() -> (verifier: String, challenge: String) {
    var bytes = [UInt8](repeating: 0, count: 48)
    if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) != errSecSuccess {
      bytes = bytes.map { _ in UInt8.random(in: .min ... .max) }
    }
    let verifier = base64URL(Data(bytes))
    return (verifier, base64URL(Data(SHA256.hash(data: Data(verifier.utf8)))))
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

  public func upload(_ fit: Data, name: String, fileName: String) async throws -> StravaUpload {
    let query = [
      URLQueryItem(name: "name", value: name), URLQueryItem(name: "fileName", value: fileName),
    ]
    let (data, response) = try await send(
      "POST", "strava/uploads", query: query, body: fit, contentType: "application/octet-stream",
      signedIn: true)
    if response.statusCode != Self.fileTurnedDownStatus { try check(response, data) }
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

  private static let fileTurnedDownStatus = 400

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
      throw StravaError.rejected(reason: report.error ?? "Strava turned the file down.")
    default:
      return nil
    }
  }

  public func sendFeedback(_ message: String, context: FeedbackContext) async throws
    -> FeedbackIssue
  {
    let (data, response) = try await send(
      "POST", "feedback", json: ["message": message, "context": context.json], signedIn: true)
    switch response.statusCode {
    case 403: throw FeedbackError.appleAccountRequired
    case 429: throw FeedbackError.dailyLimitReached
    case 503: throw FeedbackError.notConfigured
    default: try check(response, data)
    }
    struct Filed: Decodable {
      let number: Int
      let url: URL
    }
    guard let filed = try? Self.decoder.decode(Filed.self, from: data) else {
      throw StravaError.unavailable
    }
    return FeedbackIssue(number: filed.number, url: filed.url)
  }

  private func check(_ response: HTTPURLResponse, _ data: Data) throws {
    switch response.statusCode {
    case 200..<300: return
    case 401:
      forget()
      throw StravaError.signedOut
    case 409: throw StravaError.notConnected
    case 413: throw StravaError.rejected(reason: "The ride is too large to upload.")
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
    await restore()
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
