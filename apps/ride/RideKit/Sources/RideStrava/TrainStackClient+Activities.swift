import Foundation

extension TrainStackClient: ActivityServer {
  static let activitiesPath = "api-reference/activities"
  static let activityPageSize = 200

  public func signedInAccount() async throws -> ActivityAccount? {
    await restore()
    guard let session else { return nil }
    if let userID = session.userID { return ActivityAccount(id: userID, token: session.token) }
    let (data, response) = try await send("GET", "api/auth/get-session", signedIn: true)
    struct Current: Decodable {
      struct User: Decodable { let id: String }
      let user: User
    }
    switch response.statusCode {
    case 200: break
    case 401: return forgetIfStillSignedIn(as: session.token)
    default: throw StravaError.unavailable
    }
    guard let current = try? Self.decoder.decode(Current.self, from: data) else {
      return forgetIfStillSignedIn(as: session.token)
    }
    guard self.session?.token == session.token else { throw StravaError.signedOut }
    var identified = session
    identified.userID = current.user.id
    try? keep(identified)
    return ActivityAccount(id: current.user.id, token: session.token)
  }

  private func forgetIfStillSignedIn(as token: String) -> ActivityAccount? {
    if session?.token == token { forget() }
    return nil
  }

  public func activityIDs(for account: ActivityAccount) async throws -> Set<String> {
    struct Page: Decodable {
      struct Activity: Decodable { let id: String }
      let activities: [Activity]
      let nextCursor: String?
    }
    var ids: Set<String> = []
    var cursor: String?
    repeat {
      var query = [URLQueryItem(name: "limit", value: String(Self.activityPageSize))]
      if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
      let (data, response) = try await send(
        "GET", Self.activitiesPath, query: query, as: account)
      try checkActivityResponse(response, for: account)
      guard let page = try? Self.decoder.decode(Page.self, from: data) else {
        throw StravaError.unavailable
      }
      ids.formUnion(page.activities.map(\.id))
      cursor = page.nextCursor
    } while cursor != nil
    return ids
  }

  public func upload(_ file: ActivityFile, for account: ActivityAccount) async throws
    -> ActivityUploadResult
  {
    let boundary = "ride-\(UUID().uuidString)"
    let (_, response) = try await send(
      "POST", Self.activitiesPath, body: Self.multipart(file, boundary: boundary),
      contentType: "multipart/form-data; boundary=\(boundary)", as: account)
    switch response.statusCode {
    case 410: return .deletedOnTheServer
    case 400, 413, 415: return .refused
    default:
      try checkActivityResponse(response, for: account)
      return .stored
    }
  }

  public func deleteActivity(_ id: String, for account: ActivityAccount) async throws {
    let (_, response) = try await send(
      "DELETE", "\(Self.activitiesPath)/\(id)", as: account)
    try checkActivityResponse(response, for: account)
  }

  private func checkActivityResponse(_ response: HTTPURLResponse, for account: ActivityAccount)
    throws
  {
    switch response.statusCode {
    case 200..<300: return
    case 401:
      _ = forgetIfStillSignedIn(as: account.token)
      throw StravaError.signedOut
    case 429: throw StravaError.rateLimited
    default: throw StravaError.unavailable
    }
  }

  static func multipart(_ file: ActivityFile, boundary: String) -> Data {
    var body = Data()
    func field(_ name: String, _ value: String?) {
      guard let value else { return }
      body.append(
        Data(
          "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n"
            .utf8))
    }
    field("source", file.source)
    field("sport", file.sport)
    field("name", file.name)
    field(
      "startedAt",
      file.startedAt.map(Date.ISO8601FormatStyle(includingFractionalSeconds: true).format))
    let fileName = file.fileName.replacingOccurrences(of: "\"", with: "")
    body.append(
      Data(
        "--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\nContent-Type: application/octet-stream\r\n\r\n"
          .utf8))
    body.append(file.data)
    body.append(Data("\r\n--\(boundary)--\r\n".utf8))
    return body
  }
}
