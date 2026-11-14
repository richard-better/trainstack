import Foundation
import RideData
import Testing

@testable import RideStrava

struct SettingsClientTests {
  private let account = ActivityAccount(id: "user-1", token: "session-token")
  private let day = SettingDay("2026-11-13")!

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

  private var ftp: SettingChange { .threshold(sport: nil, threshold: "ftp", value: 250) }

  @Test func readsTheHistoryAfterACursorWithItsRemovals() async throws {
    let (client, transport) = identifiedClient([
      json(
        #"{"entries":[{"day":"2026-11-13","change":{"kind":"threshold","sport":null,"threshold":"ftp","value":250},"updatedAt":"2026-11-13T09:00:00.123Z"}],"removed":[{"day":"2026-11-12","key":{"kind":"weight"},"updatedAt":"2026-11-13T09:00:01.000Z"}],"cursor":"9"}"#
      )
    ])
    let history = try await client.settingsHistory(since: "4", for: account)
    #expect(
      history
        == SettingsHistory(
          writes: [
            SettingWrite(
              SettingAddress(ftp.key, on: day), ftp,
              at: SettingStamp(iso8601: "2026-11-13T09:00:00.123Z")!),
            SettingWrite(
              SettingAddress(.weight, on: SettingDay("2026-11-12")!), nil,
              at: SettingStamp(iso8601: "2026-11-13T09:00:01.000Z")!),
          ], cursor: "9"))
    let request = try #require(await transport.requests.first)
    #expect(request.httpMethod == "GET")
    #expect(request.url?.path == "/api-reference/settings/history")
    #expect(request.url?.query == "since=4")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer session-token")
  }

  @Test func keepsTheCursorWhenTheHistoryHoldsAKindOfSettingThisAppDoesNotKnow() async throws {
    let (client, _) = identifiedClient([
      json(
        #"{"entries":[{"day":"2026-11-13","change":{"kind":"rest_day"},"updatedAt":"2026-11-13T09:00:00.000Z"},{"day":"2026-11-13","change":{"kind":"weight","kg":70},"updatedAt":"2026-11-13T09:00:00.000Z"}],"removed":[],"cursor":"9"}"#
      )
    ])
    let history = try await client.settingsHistory(since: "4", for: account)
    #expect(history.writes.map(\.change) == [.weight(kg: 70)])
    #expect(history.cursor == nil)
  }

  @Test func sendsEditsAndRemovalsAsTheContractNamesThemAndReadsWhatWon() async throws {
    let (client, transport) = identifiedClient([
      json(
        #"{"entries":[{"day":"2026-11-13","change":{"kind":"threshold","sport":null,"threshold":"ftp","value":260},"updatedAt":"2026-11-13T10:00:00.000Z"}],"removed":[{"day":"2026-11-13","key":{"kind":"weight"},"updatedAt":"2026-11-13T09:00:00.000Z"}]}"#
      )
    ])
    let stamp = SettingStamp(iso8601: "2026-11-13T09:00:00.000Z")!
    let result = try await client.writeSettings(
      [
        SettingWrite(SettingAddress(ftp.key, on: day), ftp, at: stamp),
        SettingWrite(SettingAddress(.weight, on: day), nil, at: stamp),
      ], for: account)
    #expect(
      result
        == .stored([
          SettingWrite(
            SettingAddress(ftp.key, on: day), .threshold(sport: nil, threshold: "ftp", value: 260),
            at: SettingStamp(iso8601: "2026-11-13T10:00:00.000Z")!),
          SettingWrite(SettingAddress(.weight, on: day), nil, at: stamp),
        ]))
    let request = try #require(await transport.requests.first)
    #expect(request.httpMethod == "POST")
    #expect(request.url?.path == "/api-reference/settings/history")
    #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    let writes = try #require(try body(of: request)["writes"] as? [NSDictionary])
    #expect(
      writes == [
        [
          "day": "2026-11-13", "updatedAt": "2026-11-13T09:00:00.000Z",
          "change": ["kind": "threshold", "sport": NSNull(), "threshold": "ftp", "value": 250],
        ],
        [
          "day": "2026-11-13", "updatedAt": "2026-11-13T09:00:00.000Z", "remove": true,
          "key": ["kind": "weight"],
        ],
      ])
  }

  @Test func tellsWhichWriteTheServerRefused() async throws {
    let (client, _) = identifiedClient([
      json(
        #"{"defined":true,"code":"INVALID_SETTING","status":422,"message":"A write is not a valid setting","data":{"index":1,"reason":"updatedAt is later than the server's clock"}}"#,
        status: 422)
    ])
    let result = try await client.writeSettings(
      [SettingWrite(SettingAddress(ftp.key, on: day), ftp, at: .beforeAnyEdit)], for: account)
    #expect(result == .refused(index: 1, reason: "updatedAt is later than the server's clock"))
  }

  @Test func aRejectedSessionSignsOut() async throws {
    let (client, _) = identifiedClient([json("{}", status: 401)])
    await #expect(throws: StravaError.signedOut) {
      try await client.settingsHistory(since: nil, for: account)
    }
    #expect(try await client.signedInAccount() == nil)
  }

  @Test func neverSendsOneAccountsSettingsWithAnotherAccountsSession() async throws {
    let (client, transport) = identifiedClient([])
    let other = ActivityAccount(id: "user-2", token: "other-token")
    await #expect(throws: StravaError.signedOut) {
      try await client.writeSettings(
        [SettingWrite(SettingAddress(ftp.key, on: day), ftp, at: .beforeAnyEdit)], for: other)
    }
    #expect(await transport.requests.isEmpty)
  }
}
