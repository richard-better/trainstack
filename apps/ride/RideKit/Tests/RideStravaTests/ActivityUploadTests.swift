import Foundation
import Testing

@testable import RideStrava

struct ActivityUploadTests {
  private let account = ActivityAccount(id: "user-1", token: "session-token")
  private let file = ActivityFile(
    data: Data([0x0E, 0x20, 0x01]), fileName: "ride.fit", source: "trainstack",
    sport: "indoor_cycling", name: "Sweet spot",
    startedAt: Date(timeIntervalSince1970: 1_780_290_000))

  private func identifiedClient(_ replies: [Reply]) -> (TrainstackClient, ScriptedTransport) {
    let transport = ScriptedTransport(replies)
    let store = InMemorySessionStore(
      AccountSession(token: "session-token", name: "Ada Rider", userID: "user-1"))
    return (
      TrainstackClient(
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

  @Test func sendsTheSourcesOwnIDOnlyWhenTheFileHasOne() async throws {
    let (client, transport) = identifiedClient([json(#"{"id":"abc"}"#), json(#"{"id":"def"}"#)])
    var healthFile = file
    healthFile.source = "apple_health"
    healthFile.sourceID = "8F2C1D0E-1111-4A2B-9C3D-4E5F60718293"
    _ = try await client.upload(healthFile, for: account)
    _ = try await client.upload(file, for: account)
    let bodies = await transport.requests.map {
      String(decoding: $0.httpBody ?? Data(), as: UTF8.self)
    }
    #expect(bodies[0].contains("name=\"sourceId\"\r\n\r\n8F2C1D0E-1111-4A2B-9C3D-4E5F60718293\r\n"))
    #expect(!bodies[1].contains("sourceId"))
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

  @Test func restoresTheSameMultipartFormAtItsOwnPath() async throws {
    let deleted = json(
      #"{"code":"ACTIVITY_DELETED","status":410,"data":{"id":"abc","deletedAt":"2026-11-13T00:00:00.000Z"}}"#,
      status: 410)
    let (client, transport) = identifiedClient([json(#"{"id":"abc"}"#), deleted])
    #expect(try await client.restore(file, for: account) == .stored)
    #expect(try await client.restore(file, for: account) == .deletedOnTheServer)
    let request = try #require(await transport.requests.first)
    #expect(request.httpMethod == "POST")
    #expect(request.url?.path == "/api-reference/activities/restore")
    let body = String(decoding: try #require(request.httpBody), as: UTF8.self)
    #expect(body.contains("name=\"file\"; filename=\"ride.fit\""))
  }

  @Test func listsEveryActivityAcrossPages() async throws {
    let (client, transport) = identifiedClient([
      json(#"{"activities":[{"id":"a"},{"id":"b"}],"nextCursor":"1.b"}"#),
      json(#"{"activities":[{"id":"c"}],"nextCursor":null}"#),
    ])
    #expect(try await client.activities(for: account).map(\.id) == ["a", "b", "c"])
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
      try await client.activities(for: account)
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

  @Test func readsWhatHistoryShowsOfEachActivityAndKeepsOnlyTheFiguresItUses() async throws {
    let (client, _) = identifiedClient([
      json(
        #"{"activities":[{"id":"a","source":"apple_health","sourceId":"x","sport":"running","indoor":false,"name":"Easy run","startedAt":"2026-11-01T07:00:00.000Z","createdAt":"2026-11-01T08:00:00.000Z","file":{"format":"fit","size":2048},"summarizedAt":"2026-11-01T08:00:01.000Z","summaryError":null,"statistics":{"timer_s":2700,"distance_m":8100.5,"best_power_5s_w":400,"time_in_heart_rate_zone_2_s":1200},"analysisDue":false,"primary":true,"duplicates":[{"id":"b","source":"upload","primary":false}],"logged":null,"route":{"segments":["abc"],"bounds":[0,0,1,1]}}],"nextCursor":null}"#
      )
    ])
    let run = try #require(try await client.activities(for: account).first)
    #expect(run.source == "apple_health")
    #expect(run.sport == "running")
    #expect(run.indoor == false)
    #expect(run.name == "Easy run")
    #expect(run.startedAt == Date(timeIntervalSince1970: 1_793_516_400))
    #expect(run.file == AccountActivity.File(format: "fit", size: 2048))
    #expect(
      run.statistics == [
        "timer_s": 2700, "distance_m": 8100.5, "time_in_heart_rate_zone_2_s": 1200,
      ])
    #expect(run.primary)
    #expect(run.duplicateIDs == ["b"])
    #expect(run.logged == nil)
  }

  @Test func readsALoggedSessionsSummary() async throws {
    let (client, _) = identifiedClient([
      json(
        #"{"activities":[{"id":"s","source":"trainstack","sport":"strength","file":null,"statistics":{"elapsed_s":3600},"primary":true,"duplicates":[],"logged":{"sessionId":"9a","summary":{"sport":"strength","exercises":5,"sets":18,"reps":120,"volumeKg":5400.5,"unit":"kg"}}},{"id":"c","sport":"bouldering","file":null,"statistics":{},"primary":true,"duplicates":[],"logged":{"sessionId":"9b","summary":{"sport":"bouldering","problems":12,"tops":9,"sends":4,"flashes":3,"attempts":30,"hardestTop":{"grade":{"scale":"font","grade":"6B+"},"circuit":null,"font":"6B+","v":"V4"},"hardestFlash":{"grade":{"scale":"circuit","colour":"Blue"},"circuit":"Blue","font":null,"v":null}}}}],"nextCursor":null}"#
      )
    ])
    let sessions = try await client.activities(for: account)
    #expect(
      sessions[0].logged
        == LoggedSummary(
          sport: "strength", exercises: 5, sets: 18, reps: 120, volumeKg: 5400.5, unit: "kg"))
    #expect(sessions[0].file == nil)
    #expect(
      sessions[1].logged
        == LoggedSummary(
          sport: "bouldering", problems: 12, tops: 9, sends: 4, flashes: 3, attempts: 30,
          hardestTop: "6B+", hardestFlash: "Blue"))
  }

  @Test func anActivityThisVersionCannotFullyReadIsStillListed() async throws {
    let (client, _) = identifiedClient([
      json(
        #"{"activities":[{"id":"a","sport":7,"startedAt":"not a date","logged":{"sessionId":"1","summary":{"sport":"yoga"}}}],"nextCursor":null}"#
      )
    ])
    let activity = try #require(try await client.activities(for: account).first)
    #expect(activity.id == "a")
    #expect(activity.sport == nil)
    #expect(activity.startedAt == nil)
    #expect(activity.logged == LoggedSummary(sport: "yoga"))
  }

  @Test func aListedActivityKeepsWhatItReadWhenStoredAndReadAgain() async throws {
    let activity = AccountActivity(
      id: "a", source: "upload", sport: "running", indoor: false, name: "Run",
      startedAt: Date(timeIntervalSince1970: 1_793_516_400), statistics: ["timer_s": 60],
      primary: false, duplicateIDs: ["b"],
      logged: LoggedSummary(sport: "bouldering", hardestTop: "7A"))
    let data = try JSONEncoder().encode(activity)
    #expect(try JSONDecoder().decode(AccountActivity.self, from: data) == activity)
  }

  @Test func readsAnActivitysLapsAndRoute() async throws {
    let (client, transport) = identifiedClient([
      json(
        #"{"id":"a","route":{"segments":["_p~iF~ps|U_ulLnnqC"],"bounds":[0,0,1,1]},"events":[{"type":"pause","startedAt":"2026-11-01T07:10:00.000Z","endedAt":"2026-11-01T07:11:00.000Z","data":{}},{"type":"lap","startedAt":"2026-11-01T07:00:00.000Z","endedAt":"2026-11-01T07:20:00.000Z","data":{"timer_s":1200,"average_power_w":210,"trigger":"manual"}}]}"#
      )
    ])
    let detail = try await client.activityDetail("a", for: account)
    #expect(await transport.requests.first?.url?.path == "/api-reference/activities/a")
    #expect(detail.route == AccountActivityDetail.Route(segments: ["_p~iF~ps|U_ulLnnqC"]))
    #expect(
      detail.laps == [
        .init(
          startedAt: Date(timeIntervalSince1970: 1_793_516_400),
          endedAt: Date(timeIntervalSince1970: 1_793_517_600),
          statistics: ["timer_s": 1200, "average_power_w": 210])
      ])
  }

  @Test func downloadsAnActivitysFileAsItIs() async throws {
    let (client, transport) = identifiedClient([Reply(status: 200, body: "FIT bytes")])
    #expect(try await client.activityFile("a", for: account) == Data("FIT bytes".utf8))
    #expect(await transport.requests.first?.url?.path == "/api-reference/activities/a/file")
    #expect(
      await transport.requests.first?.value(forHTTPHeaderField: "Authorization")
        == "Bearer session-token")
  }

  @Test func aFileTheServerDoesNotHaveIsNotTakenForTheFile() async throws {
    let (client, _) = identifiedClient([json(#"{"code":"NOT_FOUND"}"#, status: 404)])
    await #expect(throws: StravaError.unavailable) {
      try await client.activityFile("a", for: account)
    }
  }
}
