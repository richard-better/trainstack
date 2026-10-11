import AuthenticationServices
import CryptoKit
import SwiftUI

struct SignInView: View {
  @Environment(AppModel.self) private var model
  @State private var email = ""
  @State private var password = ""
  @State private var name = ""
  @State private var creating = false
  @State private var busy = false
  @State private var server = ""
  @State private var appleAvailable = false
  @State private var nonce = ""
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        Image("garden", bundle: .module).resizable().scaledToFill().frame(height: 200).clipped()
          .clipShape(.rect(cornerRadius: 24)).accessibilityHidden(true)
        Text("TRAINSTACK / PREHAB").font(.caption.monospaced()).foregroundStyle(.secondary)
        Text("A little care.\nMore possibility.").font(.largeTitle.bold().italic())
        Text("Build a daily practice that fits your body and the sports you love.").foregroundStyle(
          .secondary)
        if creating { TextField("Your name", text: $name).textContentType(.name) }
        TextField("Email", text: $email).textContentType(.emailAddress)
        SecureField("Password", text: $password).textContentType(
          creating ? .newPassword : .password)
        Button(creating ? "Create account" : "Sign in") {
          busy = true
          Task {
            await model.perform {
              try await model.authenticate(
                email: email, password: password, name: creating ? name : nil, server: server)
            }
            busy = false
          }
        }.buttonStyle(.borderedProminent).disabled(
          busy || email.isEmpty || password.count < 8 || (creating && name.isEmpty))
        if appleAvailable {
          SignInWithAppleButton(.signIn) { request in
            nonce = UUID().uuidString
            request.requestedScopes = [.fullName, .email]
            request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }
              .joined()
          } onCompletion: { result in
            Task {
              await model.perform {
                let authorization = try result.get()
                guard
                  let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let data = credential.identityToken,
                  let token = String(data: data, encoding: .utf8)
                else { return }
                try await model.signInWithApple(token: token, nonce: nonce)
              }
            }
          }.frame(height: 44)
        }
        if busy { ProgressView() }
        Button(creating ? "Already have an account? Sign in" : "New here? Create an account") {
          creating.toggle()
        }
        DisclosureGroup("Server") { TextField("Server URL", text: $server).textContentType(.URL) }
      }.textFieldStyle(.roundedBorder).padding(24).frame(maxWidth: 520)
    }.frame(maxWidth: .infinity).onAppear { server = model.server }
      .task {
        if let config = try? await model.api.configuration() {
          appleAvailable = config["auth"]["apple"].bool
        }
      }
  }
}
