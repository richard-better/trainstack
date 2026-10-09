import Foundation

/// Talks to Strava for the rider who has signed in: keeps their tokens fresh and uploads rides.
public actor StravaClient {
  private let server: URL
  private let store: any StravaTokenStore
  private let transport: any StravaTransport
  private let now: @Sendable () -> Date
  private let pollInterval: Duration
  private let pollLimit: Int
  private var tokens: StravaTokens?

  private static let uploads = URL(string: "https://www.strava.com/api/v3/uploads")!

  public init(
    server: URL = StravaSignIn.server, store: any StravaTokenStore = KeychainStravaTokenStore(),
    transport: any StravaTransport = URLSession.shared,
    now: @escaping @Sendable () -> Date = { .now },
    pollInterval: Duration = .seconds(2), pollLimit: Int = 30
  ) {
    self.server = server
    self.store = store
    self.transport = transport
    self.now = now
    self.pollInterval = pollInterval
    self.pollLimit = pollLimit
    tokens = store.load()
  }

  /// Who is signed in, or nil if nobody is.
  public var athleteName: String? { tokens?.athleteName }
  public var isConnected: Bool { tokens != nil }

  // MARK: Signing in and out

  /// Trades the ticket a sign-in ended with for the rider's tokens, and keeps them.
  public func connect(ticket: String, signIn: StravaSignIn) async throws {
    let body = ["ticket": ticket, "code_verifier": signIn.verifier]
    let (data, response) = try await post("strava/redeem", json: body)
    switch response.statusCode {
    case 200: break
    case 503: throw StravaError.notConfigured
    case 400: throw StravaError.signInFailed
    default: throw StravaError.unavailable
    }
    struct Redeemed: Decodable {
      let accessToken: String
      let refreshToken: String
      let expiresAt: TimeInterval
      let athleteName: String?
    }
    guard let redeemed = try? Self.decoder.decode(Redeemed.self, from: data) else {
      throw StravaError.signInFailed
    }
    save(
      StravaTokens(
        accessToken: redeemed.accessToken, refreshToken: redeemed.refreshToken,
        expiresAt: Date(timeIntervalSince1970: redeemed.expiresAt),
        athleteName: redeemed.athleteName))
  }

  /// Forgets the sign-in on this device. The rider can also revoke it in Strava's settings.
  public func disconnect() { save(nil) }

  private func save(_ tokens: StravaTokens?) {
    self.tokens = tokens
    store.save(tokens)
  }

  // MARK: Tokens

  /// An access token with time left, refreshed first if it is about to run out.
  private func accessToken(forceRefresh: Bool = false) async throws -> String {
    guard let current = tokens else { throw StravaError.notConnected }
    guard forceRefresh || current.isExpiring(at: now()) else { return current.accessToken }

    let (data, response) = try await post(
      "strava/refresh", json: ["refresh_token": current.refreshToken])
    switch response.statusCode {
    case 200: break
    case 401:
      // The rider revoked Ride in Strava, so the sign-in is no use any more.
      save(nil)
      throw StravaError.notConnected
    case 503: throw StravaError.notConfigured
    default: throw StravaError.unavailable
    }
    struct Refreshed: Decodable {
      let accessToken: String
      let refreshToken: String
      let expiresAt: TimeInterval
    }
    guard let refreshed = try? Self.decoder.decode(Refreshed.self, from: data) else {
      throw StravaError.unavailable
    }
    var updated = current
    updated.accessToken = refreshed.accessToken
    updated.refreshToken = refreshed.refreshToken
    updated.expiresAt = Date(timeIntervalSince1970: refreshed.expiresAt)
    save(updated)
    return updated.accessToken
  }

  // MARK: Uploading

  /// Sends a ride's FIT file to Strava as an indoor trainer ride, and waits for Strava to make an
  /// activity of it.
  public func upload(_ fit: Data, name: String, fileName: String) async throws -> StravaUpload {
    var token = try await accessToken()
    var (data, response) = try await sendUpload(fit, name: name, fileName: fileName, token: token)
    if response.statusCode == 401 {
      // Strava no longer accepts the token it gave, such as after a new sign-in elsewhere.
      token = try await accessToken(forceRefresh: true)
      (data, response) = try await sendUpload(fit, name: name, fileName: fileName, token: token)
    }
    try Self.check(response)
    let started = try Self.status(of: data)
    if let result = try Self.finished(started) { return result }

    for _ in 0..<pollLimit {
      try await Task.sleep(for: pollInterval)
      var request = URLRequest(url: Self.uploads.appending(path: String(started.id)))
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      let (data, response) = try await transport.send(request)
      try Self.check(response)
      if let result = try Self.finished(try Self.status(of: data)) { return result }
    }
    throw StravaError.stillProcessing
  }

  private func sendUpload(
    _ fit: Data, name: String, fileName: String, token: String
  ) async throws -> (Data, HTTPURLResponse) {
    var form = MultipartForm()
    form.addField("data_type", "fit")
    form.addField("name", name)
    form.addField("trainer", "1")
    form.addFile("file", fileName: fileName, data: fit)
    var request = URLRequest(url: Self.uploads)
    request.httpMethod = "POST"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue(form.contentType, forHTTPHeaderField: "Content-Type")
    request.httpBody = form.data
    do {
      return try await transport.send(request)
    } catch is CancellationError {
      throw CancellationError()
    } catch {
      throw StravaError.unavailable
    }
  }

  private struct UploadStatus: Decodable {
    let id: Int
    let error: String?
    let activityId: Int?
  }

  private static func status(of data: Data) throws -> UploadStatus {
    guard let status = try? decoder.decode(UploadStatus.self, from: data) else {
      throw StravaError.unavailable
    }
    return status
  }

  /// The activity if Strava has made one, an error if it turned the file down, and nil while it
  /// is still working.
  private static func finished(_ status: UploadStatus) throws -> StravaUpload? {
    if let message = status.error, !message.isEmpty {
      if message.localizedCaseInsensitiveContains("duplicate") {
        let digits = message.split(whereSeparator: { !$0.isNumber }).last
        throw StravaError.duplicate(activityID: digits.flatMap { Int($0) })
      }
      throw StravaError.rejected(message)
    }
    return status.activityId.map(StravaUpload.init(activityID:))
  }

  private static func check(_ response: HTTPURLResponse) throws {
    switch response.statusCode {
    case 200..<300: return
    case 401: throw StravaError.notConnected
    case 429: throw StravaError.rateLimited
    case 400..<500: throw StravaError.rejected("Strava answered \(response.statusCode).")
    default: throw StravaError.unavailable
    }
  }

  // MARK: Requests

  private func post(_ path: String, json: [String: String]) async throws -> (Data, HTTPURLResponse)
  {
    var request = URLRequest(url: server.appending(path: path))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: json)
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
