import Foundation
import Testing

@testable import RideStrava

struct FeedbackTests {
  @Test func sendsFeedbackWithItsContextAndReturnsTheIssue() async throws {
    let (client, transport, _) = client([
      json(
        #"{"number":101,"url":"https://github.com/richard-better/trainstack/issues/101"}"#,
        status: 201)
    ])
    let issue = try await client.sendFeedback(
      "Show the FTP line",
      context: FeedbackContext(app: "Ride 0.4 (57)", system: "iOS 27.1", screen: "History"))

    #expect(
      issue
        == FeedbackIssue(
          number: 101, url: URL(string: "https://github.com/richard-better/trainstack/issues/101")!
        ))
    let request = try #require(await transport.requests.first)
    #expect(request.httpMethod == "POST")
    #expect(request.url?.absoluteString == "https://api.example.com/feedback")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer session-token")
    let sent = try body(of: request)
    #expect(sent["message"] as? String == "Show the FTP line")
    #expect(
      sent["context"] as? [String: String]
        == ["app": "Ride 0.4 (57)", "system": "iOS 27.1", "screen": "History"])
  }

  @Test func needsASignIn() async {
    let (client, transport, _) = client([], signedIn: false)
    await #expect(throws: StravaError.signedOut) {
      try await client.sendFeedback("Hi", context: FeedbackContext())
    }
    #expect(await transport.requests.isEmpty)
  }

  @Test func explainsWhyTheServerTurnedItDown() async {
    func failure(_ status: Int) async -> (any Error)? {
      let (client, _, _) = client([json(#"{"error":"x"}"#, status: status)])
      do {
        _ = try await client.sendFeedback("Hi", context: FeedbackContext())
        return nil
      } catch {
        return error
      }
    }
    #expect(await failure(403) as? FeedbackError == .appleAccountRequired)
    #expect(await failure(429) as? FeedbackError == .dailyLimitReached)
    #expect(await failure(503) as? FeedbackError == .notConfigured)
    #expect(await failure(502) as? StravaError == .unavailable)
    #expect(await failure(401) as? StravaError == .signedOut)
  }
}
