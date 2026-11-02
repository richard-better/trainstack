import Foundation
import Testing

@testable import RideStrava

typealias Reply = ScriptedTransport.Reply

let signedInSession = AccountSession(token: "session-token", name: "Ada Rider")

func client(
  _ replies: [Reply], signedIn: Bool = true, pollLimit: Int = 5
) -> (TrainStackClient, ScriptedTransport, InMemorySessionStore) {
  let transport = ScriptedTransport(replies)
  let store = InMemorySessionStore(signedIn ? signedInSession : nil)
  let client = TrainStackClient(
    server: URL(string: "https://api.example.com")!, store: store, transport: transport,
    pollInterval: .zero, pollLimit: pollLimit)
  return (client, transport, store)
}

func json(_ text: String, status: Int = 200) -> Reply {
  Reply(status: status, body: text)
}

func body(of request: URLRequest) throws -> [String: Any] {
  let data = try #require(request.httpBody)
  let object = try JSONSerialization.jsonObject(with: data)
  return try #require(object as? [String: Any])
}
