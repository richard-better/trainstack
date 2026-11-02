import Foundation
import Testing

@testable import RideStrava

struct StravaUploadTests {
  @Test func sendsTheFileAndWaitsForTheActivity() async throws {
    let (client, transport, _) = client([
      json(#"{"id":7,"status":"processing"}"#, status: 202),
      json(#"{"id":7,"status":"processing"}"#),
      json(#"{"id":7,"status":"ready","activityId":99}"#),
    ])
    let fit = Data([0x0E, 0x20, 0x01, 0x02])
    let upload = try await client.upload(fit, name: "Threshold 3x12", fileName: "ride.fit")

    #expect(upload.activityID == 99)
    #expect(upload.url.absoluteString == "https://www.strava.com/activities/99")
    let requests = await transport.requests
    #expect(requests.count == 3)
    let first = requests[0]
    #expect(first.httpMethod == "POST")
    let components = try #require(URLComponents(url: first.url!, resolvingAgainstBaseURL: false))
    #expect(components.path == "/strava/uploads")
    #expect(
      components.queryItems
        == [
          URLQueryItem(name: "name", value: "Threshold 3x12"),
          URLQueryItem(name: "fileName", value: "ride.fit"),
        ])
    #expect(first.value(forHTTPHeaderField: "Authorization") == "Bearer session-token")
    #expect(first.value(forHTTPHeaderField: "Content-Type") == "application/octet-stream")
    #expect(first.httpBody == fit)
    #expect(requests[1].url?.path == "/strava/uploads/7")
    #expect(requests[1].httpMethod == "GET")
  }

  @Test func recognisesARideStravaAlreadyHas() async {
    let (client, _, _) = client([
      json(
        #"{"id":7,"status":"error","error":"ride.fit duplicate of activity 4321","duplicateOf":4321}"#,
        status: 400)
    ])
    await #expect(throws: StravaError.duplicate(activityID: 4321)) {
      try await client.upload(Data([1]), name: "Ride", fileName: "ride.fit")
    }
  }

  @Test func passesOnWhyStravaTurnedTheFileDown() async {
    let (client, _, _) = client([
      json(#"{"id":7,"status":"processing"}"#, status: 202),
      json(#"{"id":7,"status":"error","error":"The file is empty."}"#),
    ])
    await #expect(throws: StravaError.rejected(reason: "The file is empty.")) {
      try await client.upload(Data([1]), name: "Ride", fileName: "ride.fit")
    }
  }

  @Test func explainsWhyTheServerRefusedTheRide() async {
    func failure(_ status: Int, _ body: String = "{}") async -> StravaError? {
      let (client, _, _) = client([json(body, status: status)])
      do {
        _ = try await client.upload(Data([1]), name: "Ride", fileName: "ride.fit")
        return nil
      } catch {
        return error as? StravaError
      }
    }
    #expect(await failure(409, #"{"error":"not_connected"}"#) == .notConnected)
    #expect(await failure(429) == .rateLimited)
    #expect(await failure(413) == .rejected(reason: "The ride is too large to upload."))
    #expect(await failure(502) == .unavailable)
    #expect(await failure(503, #"{"error":"strava_not_configured"}"#) == .notConfigured)
  }

  @Test func givesUpWaitingWhenStravaIsStillProcessing() async {
    let pending = json(#"{"id":7,"status":"processing"}"#)
    let (client, transport, _) = client(
      [json(pending.body, status: 202), pending, pending, pending], pollLimit: 3)
    await #expect(throws: StravaError.stillProcessing) {
      try await client.upload(Data([1]), name: "Ride", fileName: "ride.fit")
    }
    #expect(await transport.requests.count == 4)
  }

  @Test func reportsAnUnreachableServer() async {
    let (client, _, _) = client([Reply(fails: true)])
    await #expect(throws: StravaError.unavailable) {
      try await client.upload(Data([1]), name: "Ride", fileName: "ride.fit")
    }
  }
}
