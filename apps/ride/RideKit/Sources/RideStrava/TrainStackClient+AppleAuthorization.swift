import Foundation

extension TrainStackClient {
  public func keepAppleAuthorization(code: String) async throws {
    let (data, response) = try await send(
      "POST", "account/apple-authorization", json: ["authorization_code": code], signedIn: true)
    let error = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
    switch (response.statusCode, error) {
    case (204, _): return
    case (400, "invalid_code"): throw AppleAuthorizationError.invalidCode
    case (400, _): throw AppleAuthorizationError.invalidRequest
    case (401, _): throw StravaError.signedOut
    case (403, _): throw AppleAuthorizationError.appleAccountRequired
    case (409, _): throw AppleAuthorizationError.anotherAppleID
    case (502, _): throw AppleAuthorizationError.appleUnavailable
    case (503, _): throw AppleAuthorizationError.appleNotConfigured
    default: throw StravaError.unavailable
    }
  }
}
