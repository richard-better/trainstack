import Foundation
import Testing

@testable import RideStrava

struct ActivityUploadTests {
  private let account = ActivityAccount(id: "user-1", token: "session-token")
  private let file = ActivityFile(
    data: Data([0x0E, 0x20, 0x01]), fileName: "ride.fit", source: "trainstack",
    sport: "indoor_cycling", name: "Sweet spot",
    startedAt: Date(timeIntervalSince1970: 1_780_290_000))

  private func identifiedClient(_ replies: [Reply]) -> (TrainStackClient, ScriptedTransport) {
    let transport = ScriptedTransport(replies)
    let store = InMemorySessionStore(
      AccountSession(token: "session-token", name: "Ada Rider", userID: "user-1"))
    return (
      TrainStackClient(
        server: URL(string: "https://api.example.com")!, store: store, transport: transport),
      transport
    )
  }

  @Test func uploadsTheFileAsAMultipartFormWithTheRidesDetails() async throws {
    let (client, transport) = identifiedClient([json(#"{"id":"abc"}"#)])
    #expect(try await client.upload(file, for: account) == .stored)
    let request = try #require(await transport.requests.first)
    #expect(request.httpMethod == "POST")
    #expect(request.url?.path == "/api-reference/activities")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer session-token")
    let contentType = try #require(request.value(forHTTPHeaderField: "Content-Type"))
    #expect(contentType.hasPrefix("multipart/form-data; boundary="))
    let body = String(decoding: try #require(request.httpBody), as: UTF8.self)
    #expect(body.contains("name=\"source\"\r\n\r\ntrainstack\r\n"))
    #expect(body.contains("name=\"sport\"\r\n\r\nindoor_cycling\r\n"))
    #expect(body.contains("name=\"name\"\r\n\r\nSweet spot\r\n"))
    #expect(body.contains("name=\"startedAt\"\r\n\r\n2026-06-01T05:00:00.000Z\r\n"))
    #expect(body.contains("name=\"file\"; filename=\"ride.fit\""))
  }

  @Test func tellsAFileTheServerDeletedApartFromOneItRefuses() async throws {
    let deleted = json(
      #"{"code":"ACTIVITY_DELETED","status":410,"data":{"id":"abc","deletedAt":"2026-11-13T00:00:00.000Z"}}"#,
      status: 410)
    let (client, _) = identifiedClient([deleted, json("{}", status: 415), json("{}", status: 413)])
    #expect(try await client.upload(file, for: account) == .deletedOnTheServer)
    #expect(try await client.upload(file, for: account) == .refused)
    #expect(try await client.upload(file, for: account) == .refused)
  }

  @Test func listsEveryActivityIDAcrossPages() async throws {
    let (client, transport) = identifiedClient([
      json(#"{"activities":[{"id":"a"},{"id":"b"}],"nextCursor":"1.b"}"#),
      json(#"{"activities":[{"id":"c"}],"nextCursor":null}"#),
    ])
    #expect(try await client.activityIDs(for: account) == ["a", "b", "c"])
    let requests = await transport.requests
    let second = try #require(URLComponents(url: requests[1].url!, resolvingAgainstBaseURL: false))
    #expect(second.queryItems?.contains(URLQueryItem(name: "cursor", value: "1.b")) == true)
    #expect(second.queryItems?.contains(URLQueryItem(name: "limit", value: "200")) == true)
  }

  @Test func deletesAnActivityByItsID() async throws {
    let (client, transport) = identifiedClient([json(#"{"id":"abc","deletedAt":"x"}"#)])
    try await client.deleteActivity("abc", for: account)
    let request = try #require(await transport.requests.first)
    #expect(request.httpMethod == "DELETE")
    #expect(request.url?.path == "/api-reference/activities/abc")
  }

  @Test func neverSendsOneAccountsRequestWithAnotherAccountsSession() async throws {
    let (client, transport) = identifiedClient([])
    let other = ActivityAccount(id: "user-2", token: "other-token")
    await #expect(throws: StravaError.signedOut) {
      try await client.deleteActivity("abc", for: other)
    }
    #expect(await transport.requests.isEmpty)
  }

  @Test func aRejectedSessionSignsOut() async throws {
    let (client, _) = identifiedClient([json("{}", status: 401)])
    await #expect(throws: StravaError.signedOut) {
      try await client.activityIDs(for: account)
    }
    #expect(try await client.signedInAccount() == nil)
  }

  @Test func learnsWhichAccountASessionBelongsToOnceAndKeepsIt() async throws {
    let (client, transport, store) = client([json(#"{"session":{},"user":{"id":"user-9"}}"#)])
    let account = try #require(try await client.signedInAccount())
    #expect(account.id == "user-9")
    #expect(try await client.signedInAccount()?.id == "user-9")
    let requests = await transport.requests
    #expect(requests.count == 1)
    #expect(requests[0].url?.path == "/api/auth/get-session")
    #expect(await store.load()?.userID == "user-9")
  }

  @Test func signingInKeepsTheAccountsID() async throws {
    let (client, _, store) = client(
      [json(#"{"token":"new","user":{"id":"user-3","name":"Ada"}}"#)], signedIn: false)
    try await client.signInWithApple(identityToken: "t", nonce: "n", fullName: nil)
    #expect(await store.load()?.userID == "user-3")
  }

  @Test func aSessionTheServerNoLongerKnowsIsForgotten() async throws {
    let (client, _, store) = client([json("null")])
    #expect(try await client.signedInAccount() == nil)
    #expect(await store.load() == nil)
  }
}
