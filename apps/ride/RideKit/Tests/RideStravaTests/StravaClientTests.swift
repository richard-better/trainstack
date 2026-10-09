import Foundation
import Testing

@testable import RideStrava

/// Answers requests from a script and remembers them.
private actor FakeTransport: StravaTransport {
  struct Reply {
    var status = 200
    var body = "{}"
  }

  private(set) var requests: [URLRequest] = []
  private var replies: [Reply]

  init(_ replies: [Reply]) {
    self.replies = replies
  }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    requests.append(request)
    let reply = replies.isEmpty ? Reply() : replies.removeFirst()
    let response = HTTPURLResponse(
      url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: nil)!
    return (Data(reply.body.utf8), response)
  }
}

private let server = URL(string: "https://api.example.com")!
private let epoch = Date(timeIntervalSince1970: 1_800_000_000)
private let signIn = StravaSignIn(state: "state-from-the-app-0123456789abcd", verifier: "v")

private func tokens(expiresIn seconds: TimeInterval = 3600) -> StravaTokens {
  StravaTokens(
    accessToken: "access-0", refreshToken: "refresh-0",
    expiresAt: epoch.addingTimeInterval(seconds), athleteName: "Ada Rider")
}

private func client(
  _ replies: [FakeTransport.Reply], store: InMemoryStravaTokenStore? = nil,
  pollLimit: Int = 5
) -> (StravaClient, FakeTransport, InMemoryStravaTokenStore) {
  let transport = FakeTransport(replies)
  let store = store ?? InMemoryStravaTokenStore(tokens())
  let client = StravaClient(
    server: server, store: store, transport: transport, now: { epoch },
    pollInterval: .zero, pollLimit: pollLimit)
  return (client, transport, store)
}

private func json(_ text: String, status: Int = 200) -> FakeTransport.Reply {
  .init(status: status, body: text)
}

private let refreshed = json(
  #"{"access_token":"access-1","refresh_token":"refresh-1","expires_at":1800007200}"#)

struct StravaClientTests {
  @Test func redeemsTheTicketAndKeepsTheTokens() async throws {
    let (client, transport, store) = client(
      [
        json(
          #"{"access_token":"a","refresh_token":"r","expires_at":1800003600,"athlete_name":"Ada Rider"}"#
        )
      ], store: InMemoryStravaTokenStore())
    #expect(await !client.isConnected)
    try await client.connect(ticket: "the-ticket", signIn: signIn)

    #expect(await client.athleteName == "Ada Rider")
    #expect(store.load()?.accessToken == "a")
    #expect(store.load()?.refreshToken == "r")
    let request = try #require(await transport.requests.first)
    #expect(request.url == server.appending(path: "strava/redeem"))
    let body =
      try JSONSerialization.jsonObject(with: try #require(request.httpBody)) as? [String: String]
    #expect(body == ["ticket": "the-ticket", "code_verifier": "v"])
  }

  @Test func reportsATicketTheServerWillNotRedeem() async {
    let (client, _, store) = client([json("{}", status: 400)], store: InMemoryStravaTokenStore())
    await #expect(throws: StravaError.signInFailed) {
      try await client.connect(ticket: "stale", signIn: signIn)
    }
    #expect(store.load() == nil)
  }

  @Test func disconnectingForgetsTheSignIn() async {
    let (client, _, store) = client([])
    #expect(await client.isConnected)
    await client.disconnect()
    #expect(await !client.isConnected)
    #expect(store.load() == nil)
  }

  @Test func uploadsTheFileAsATrainerRideAndWaitsForTheActivity() async throws {
    let (client, transport, _) = client([
      json(#"{"id":7,"error":null,"activity_id":null}"#, status: 201),
      json(#"{"id":7,"error":null,"activity_id":null}"#),
      json(#"{"id":7,"error":null,"activity_id":99}"#),
    ])
    let fit = Data([0x0E, 0x20, 0x01, 0x02])
    let upload = try await client.upload(fit, name: "Threshold 3x12", fileName: "ride.fit")

    #expect(upload.activityID == 99)
    #expect(upload.url.absoluteString == "https://www.strava.com/activities/99")
    let requests = await transport.requests
    #expect(requests.count == 3)
    let first = requests[0]
    #expect(first.url?.absoluteString == "https://www.strava.com/api/v3/uploads")
    #expect(first.value(forHTTPHeaderField: "Authorization") == "Bearer access-0")
    #expect(
      first.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data; boundary=")
        == true)
    let body = try #require(first.httpBody)
    let text = String(decoding: body, as: UTF8.self)
    #expect(text.contains("name=\"data_type\"\r\n\r\nfit\r\n"))
    #expect(text.contains("name=\"trainer\"\r\n\r\n1\r\n"))
    #expect(text.contains("name=\"name\"\r\n\r\nThreshold 3x12\r\n"))
    #expect(text.contains("name=\"file\"; filename=\"ride.fit\""))
    #expect(body.range(of: fit) != nil)
    #expect(requests[1].url?.absoluteString == "https://www.strava.com/api/v3/uploads/7")
    #expect(requests[1].httpMethod != "POST")
  }

  @Test func refreshesATokenThatIsAboutToRunOutBeforeUploading() async throws {
    let (client, transport, store) = client(
      [refreshed, json(#"{"id":7,"error":null,"activity_id":99}"#, status: 201)],
      store: InMemoryStravaTokenStore(tokens(expiresIn: 30)))
    _ = try await client.upload(Data([1]), name: "Ride", fileName: "ride.fit")

    let requests = await transport.requests
    #expect(requests[0].url == server.appending(path: "strava/refresh"))
    #expect(requests[1].value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
    #expect(store.load()?.refreshToken == "refresh-1")
    #expect(store.load()?.athleteName == "Ada Rider")
  }

  @Test func refreshesOnceWhenStravaTurnsTheTokenDown() async throws {
    let (client, transport, _) = client([
      json("{}", status: 401), refreshed,
      json(#"{"id":7,"error":null,"activity_id":99}"#, status: 201),
    ])
    _ = try await client.upload(Data([1]), name: "Ride", fileName: "ride.fit")
    let requests = await transport.requests
    #expect(requests.count == 3)
    #expect(requests[2].value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
  }

  @Test func forgetsASignInThatStravaHasRevoked() async {
    let (client, _, store) = client(
      [json(#"{"error":"invalid_refresh_token"}"#, status: 401)],
      store: InMemoryStravaTokenStore(tokens(expiresIn: 0)))
    await #expect(throws: StravaError.notConnected) {
      try await client.upload(Data([1]), name: "Ride", fileName: "ride.fit")
    }
    #expect(store.load() == nil)
    #expect(await !client.isConnected)
  }

  @Test func needsASignInToUpload() async {
    let (client, transport, _) = client([], store: InMemoryStravaTokenStore())
    await #expect(throws: StravaError.notConnected) {
      try await client.upload(Data([1]), name: "Ride", fileName: "ride.fit")
    }
    #expect(await transport.requests.isEmpty)
  }

  @Test func recognisesARideStravaAlreadyHas() async {
    let (client, _, _) = client([
      json(
        #"{"id":7,"error":"ride.fit duplicate of activity 4321","activity_id":null}"#, status: 201)
    ])
    await #expect(throws: StravaError.duplicate(activityID: 4321)) {
      try await client.upload(Data([1]), name: "Ride", fileName: "ride.fit")
    }
  }

  @Test func passesOnWhyStravaTurnedTheFileDown() async {
    let (client, _, _) = client([
      json(#"{"id":7,"error":"The file is empty.","activity_id":null}"#, status: 201)
    ])
    await #expect(throws: StravaError.rejected("The file is empty.")) {
      try await client.upload(Data([1]), name: "Ride", fileName: "ride.fit")
    }
  }

  @Test func reportsTooManyRequestsAndAnUnreachableStrava() async {
    let (limited, _, _) = client([json("{}", status: 429)])
    await #expect(throws: StravaError.rateLimited) {
      try await limited.upload(Data([1]), name: "Ride", fileName: "ride.fit")
    }
    let (down, _, _) = client([json("{}", status: 503)])
    await #expect(throws: StravaError.unavailable) {
      try await down.upload(Data([1]), name: "Ride", fileName: "ride.fit")
    }
  }

  @Test func givesUpWaitingWhenStravaIsStillProcessing() async {
    let pending = json(#"{"id":7,"error":null,"activity_id":null}"#)
    let (client, transport, _) = client(
      [json(pending.body, status: 201), pending, pending, pending], pollLimit: 3)
    await #expect(throws: StravaError.stillProcessing) {
      try await client.upload(Data([1]), name: "Ride", fileName: "ride.fit")
    }
    #expect(await transport.requests.count == 4)
  }
}
