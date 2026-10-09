import AuthenticationServices
import Foundation
import RideStrava
import Testing

@testable import RideUI

/// Answers every request with the next of `bodies`, and remembers the requests.
private actor FakeTransport: StravaTransport {
  private(set) var requests: [URLRequest] = []
  private var replies: [(status: Int, body: String)]

  init(_ replies: [(status: Int, body: String)]) {
    self.replies = replies
  }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    requests.append(request)
    let reply = replies.isEmpty ? (status: 500, body: "{}") : replies.removeFirst()
    let response = HTTPURLResponse(
      url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: nil)!
    return (Data(reply.body.utf8), response)
  }
}

struct StravaConnectionTests {
  private let redeemed = (
    status: 200,
    body:
      #"{"access_token":"a","refresh_token":"r","expires_at":4102444800,"athlete_name":"Ada Rider"}"#
  )

  @Test func picksUpASignInKeptFromAnEarlierLaunch() {
    let store = InMemoryStravaTokenStore(
      StravaTokens(
        accessToken: "a", refreshToken: "r", expiresAt: .distantFuture, athleteName: "Ada Rider"))
    let strava = StravaConnection(store: store, transport: FakeTransport([]))
    #expect(strava.isConnected)
    #expect(strava.athleteName == "Ada Rider")
    #expect(!StravaConnection(store: InMemoryStravaTokenStore()).isConnected)
  }

  @Test func signsInThroughTheWebSessionAndKeepsTheTokens() async throws {
    let store = InMemoryStravaTokenStore()
    let transport = FakeTransport([redeemed])
    let strava = StravaConnection(store: store, transport: transport)
    var opened: URL?
    try await strava.connect { url in
      opened = url
      let state = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
        .first { $0.name == "state" }?.value
      return URL(string: "trainstackride://strava?state=\(state ?? "")&ticket=the-ticket")!
    }

    #expect(opened?.path == "/strava/authorize")
    #expect(strava.isConnected)
    #expect(strava.athleteName == "Ada Rider")
    #expect(store.load()?.accessToken == "a")
    #expect(await transport.requests.count == 1)
  }

  @Test func treatsBackingOutOfTheWebSessionAsDenied() async {
    let strava = StravaConnection(store: InMemoryStravaTokenStore(), transport: FakeTransport([]))
    await #expect(throws: StravaError.denied) {
      try await strava.connect { _ in
        throw ASWebAuthenticationSessionError(.canceledLogin)
      }
    }
    #expect(!strava.isConnected)
  }

  @Test func ignoresARedirectFromAnotherSignIn() async {
    let transport = FakeTransport([redeemed])
    let strava = StravaConnection(store: InMemoryStravaTokenStore(), transport: transport)
    await #expect(throws: StravaError.stateMismatch) {
      try await strava.connect { _ in
        URL(string: "trainstackride://strava?state=someone-elses-state-0123456789&ticket=t")!
      }
    }
    #expect(!strava.isConnected)
    #expect(await transport.requests.isEmpty)
  }

  @Test func disconnectingForgetsTheSignIn() async {
    let store = InMemoryStravaTokenStore(
      StravaTokens(accessToken: "a", refreshToken: "r", expiresAt: .distantFuture))
    let strava = StravaConnection(store: store, transport: FakeTransport([]))
    await strava.disconnect()
    #expect(!strava.isConnected)
    #expect(store.load() == nil)
  }

  @Test func sendsTheRidesFitFileUnderItsExportName() async throws {
    let ride = try #require(RideLibrary.sample().rides.first)
    let transport = FakeTransport([(status: 201, body: #"{"id":7,"error":null,"activity_id":99}"#)])
    let store = InMemoryStravaTokenStore(
      StravaTokens(accessToken: "a", refreshToken: "r", expiresAt: .distantFuture))
    let strava = StravaConnection(store: store, transport: transport)

    let upload = try await strava.upload(ride)

    #expect(upload.activityID == 99)
    let body = try #require(await transport.requests.first?.httpBody)
    #expect(String(decoding: body, as: UTF8.self).contains("filename=\"\(ride.exportFileName)\""))
    #expect(body.range(of: ride.fileData) != nil)
  }
}
