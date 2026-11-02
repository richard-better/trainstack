import Foundation

@testable import RideStrava

actor ScriptedTransport: HTTPTransport {
  struct Reply {
    var status = 200
    var body = "{}"
    var headers: [String: String] = [:]
    var fails = false
  }

  private(set) var requests: [URLRequest] = []
  private var replies: [Reply]

  init(_ replies: [Reply]) {
    self.replies = replies
  }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    requests.append(request)
    let reply = replies.isEmpty ? Reply() : replies.removeFirst()
    if reply.fails { throw URLError(.notConnectedToInternet) }
    let response = HTTPURLResponse(
      url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: reply.headers)!
    return (Data(reply.body.utf8), response)
  }
}
