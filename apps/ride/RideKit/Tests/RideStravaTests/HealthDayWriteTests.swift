import Foundation
import RideData
import Testing

@testable import RideStrava

struct HealthDayWriteTests {
  private let account = ActivityAccount(id: "user-1", token: "session-token")

  private func client(_ replies: [Reply]) -> (TrainstackClient, ScriptedTransport) {
    let transport = ScriptedTransport(replies)
    let store = InMemorySessionStore(
      AccountSession(token: "session-token", name: "Ada Rider", userID: "user-1"))
    return (
      TrainstackClient(
        server: URL(string: "https://api.example.com")!, store: store, transport: transport),
      transport
    )
  }

  @Test func sendsEachDayFromAppleHealthWithItsValuesAndTheReadsStamp() async throws {
    let (client, transport) = client([json(#"{"days":[]}"#)])
    let day = MeasuredDay(
      day: SettingDay("2026-11-14")!, sleepSeconds: 15_480, restingHeartRateBpm: 61,
      hrvMs: nil)
    try await client.writeHealthDays(
      [day], at: SettingStamp(milliseconds: 1_794_650_000_123), for: account)
    let request = try #require(await transport.requests.first)
    #expect(request.httpMethod == "POST")
    #expect(request.url?.path == "/api-reference/health-days")
    let body = try #require(request.httpBody)
    let sent = try #require(
      try JSONSerialization.jsonObject(with: body) as? [String: [[String: Any]]])
    let first = try #require(sent["days"]?.first)
    #expect(first["day"] as? String == "2026-11-14")
    #expect(first["source"] as? String == "apple_health")
    #expect(first["sleepSeconds"] as? Int == 15_480)
    #expect(first["restingHeartRateBpm"] as? Double == 61)
    #expect(first["hrvMs"] is NSNull)
    #expect(first["updatedAt"] as? String == "2026-11-14T09:53:20.123Z")
  }

  @Test func aRefusedSessionSignsOut() async throws {
    let (client, _) = client([json("{}", status: 401)])
    await #expect(throws: StravaError.signedOut) {
      try await client.writeHealthDays([], at: SettingStamp(milliseconds: 0), for: account)
    }
  }
}
