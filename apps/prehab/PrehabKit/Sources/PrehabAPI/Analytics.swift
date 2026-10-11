import Foundation
import PrehabCore

/// Minimal anonymous event transport using https://posthog.com/docs/api/capture.
/// Event properties contain operation names only, never profiles, prompts or health data.
actor Analytics {
  private var configuration: JSONValue = .null
  private var distinctID = UUID().uuidString
  func configure(_ value: JSONValue) {
    configuration = value
    distinctID = UUID().uuidString
  }
  func capture(_ event: String, operation: String) async {
    guard let key = configuration["apiKey"].string,
      let host = configuration["host"].string, let base = URL(string: host), base.scheme == "https"
    else { return }
    let body: JSONValue = .object([
      "api_key": .string(key), "distinct_id": .string(distinctID), "event": .string(event),
      "properties": .object([
        "operation": .string(operation), "$process_person_profile": .bool(false),
        "$lib": .string("prehab-swift"),
      ]),
    ])
    var request = URLRequest(url: base.appending(path: "i/v0/e/"))
    request.httpMethod = "POST"
    request.timeoutInterval = 10
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONEncoder().encode(body)
    _ = try? await URLSession.shared.data(for: request)
  }
}
