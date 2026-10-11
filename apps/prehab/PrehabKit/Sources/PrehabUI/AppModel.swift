import Foundation
import Observation
import PrehabAPI
import PrehabCore

@Observable
public final class AppModel {
  var api: APIClient
  var user: JSONValue = .null
  var profile: SportProfileGetOutputProfile?
  var loading = true
  var error: String?
  var server: String
  var signedIn: Bool { user["id"].string != nil }
  var onboarded: Bool { profile?.onboardingCompletedAt != nil }
  var name: String { user["name"].string ?? "Athlete" }

  public init() {
    let initialServer =
      UserDefaults.standard.string(forKey: "prehab.server") ?? "http://localhost:3002"
    server = initialServer
    api = APIClient(baseURL: URL(string: initialServer) ?? URL(filePath: "/"))
  }
  func restore() async {
    defer { loading = false }
    await api.setAnalytics(enabled: UserDefaults.standard.bool(forKey: "prehab.analytics"))
    do {
      guard let token = try TokenStore.read(server: server) else { return }
      await api.setToken(token)
      let session = try await api.auth(path: "get-session")
      user = session["user"]
      if signedIn { try await refreshProfile() }
    } catch { self.error = error.localizedDescription }
  }
  func authenticate(email: String, password: String, name: String?, server: String) async throws {
    guard let url = URL(string: server), let host = url.host,
      url.scheme == "https"
        || (url.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host))
    else { throw APIError(message: "Use an HTTPS server URL, or localhost for development.") }
    self.server = server
    api = APIClient(baseURL: url)
    var body: [String: JSONValue] = ["email": .string(email), "password": .string(password)]
    if let name { body["name"] = .string(name) }
    let response = try await api.auth(
      path: name == nil ? "sign-in/email" : "sign-up/email", body: body)
    try await acceptAuthentication(response)
  }
  func signInWithApple(token: String, nonce: String) async throws {
    let response = try await api.auth(
      path: "sign-in/social",
      body: [
        "provider": .string("apple"),
        "idToken": .object(["token": .string(token), "nonce": .string(nonce)]),
      ])
    try await acceptAuthentication(response)
  }
  private func acceptAuthentication(_ response: JSONValue) async throws {
    guard let token = response["token"].string else {
      throw APIError(message: "Sign-in did not return a session.")
    }
    try TokenStore.write(token, server: server)
    UserDefaults.standard.set(server, forKey: "prehab.server")
    await api.setToken(token)
    await api.setAnalytics(enabled: UserDefaults.standard.bool(forKey: "prehab.analytics"))
    user = response["user"]
    try await refreshProfile()
  }
  func refreshProfile() async throws {
    profile = try await api.call(Endpoints.sportProfileGet).profile
  }
  func signOut() async throws {
    _ = try await api.auth(path: "sign-out", body: [:])
    try clearSession()
  }
  func clearSession() throws {
    try TokenStore.write(nil, server: server)
    api = APIClient(baseURL: URL(string: server) ?? URL(filePath: "/"))
    user = .null
    profile = nil
    UNReminder.cancel()
  }
  func perform(_ operation: () async throws -> Void) async {
    do { try await operation() } catch is CancellationError {} catch {
      self.error = error.localizedDescription
    }
  }
}
