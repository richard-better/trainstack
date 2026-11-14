import AuthenticationServices
import RideStrava
import SwiftUI

struct AccountSettingsView: View {
  @Environment(TrainStackAccount.self) private var account
  @Environment(\.webAuthenticationSession) private var webAuthenticationSession
  @Environment(\.authorizationController) private var authorizationController
  @State private var nonce = AppleSignInNonce()
  @State private var isWorking = false
  @State private var isConfirmingDelete = false
  @State private var errorMessage: String?

  var body: some View {
    Form {
      accountSection
      if !account.isRestoring {
        stravaSection
      }
      Section {
        Text("Compatible with Strava")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
    .navigationTitle("Account")
    .task { await account.refreshStrava() }
    .alert("Something Went Wrong", isPresented: errorShown) {
      Button("OK") {}
    } message: {
      Text(errorMessage ?? "")
    }
    .confirmationDialog("Delete your account?", isPresented: $isConfirmingDelete) {
      Button("Delete Account", role: .destructive, action: deleteAccount)
    } message: {
      Text(deletionWarning)
    }
  }

  @ViewBuilder private var accountSection: some View {
    Section {
      if account.isRestoring {
        ProgressView()
          .frame(maxWidth: .infinity)
          .accessibilityLabel("Checking your account")
      } else if account.isSignedIn {
        LabeledContent("Signed in as", value: account.name ?? "Apple account")
        Button("Sign Out", action: signOut).disabled(isWorking)
        Button("Delete Account…", role: .destructive) { isConfirmingDelete = true }
          .disabled(isWorking)
      } else if AppleSignIn.isNative {
        SignInWithAppleButton(.signIn, onRequest: prepare, onCompletion: finish)
          .frame(height: 44)
      } else {
        WebSignInWithAppleButton(isWorking: isWorking, action: signInThroughBrowser)
      }
    } header: {
      Text("TrainStack account")
    } footer: {
      Text(
        account.isSignedIn
          ? "Your account holds your rides with their files and analysis, your settings and their history, your workouts and lists, your feedback and your Strava connection. Ride sends your rides to it, so you can see them on the TrainStack website, and keeps your settings the same on every device you sign in on."
          : "Ride works without an account. Sign in to see your rides on the TrainStack website, keep your settings the same on all your devices, and send rides to Strava."
      )
    }
  }

  private var deletionWarning: String {
    let warning =
      "This permanently deletes your account and everything it holds: your rides with their files and analysis, your settings and their history, your workouts and lists, your feedback and your Strava connection. The account's link to your Apple Account is removed, every device is signed out, and signing in again starts an empty account. Rides and settings on your devices and in iCloud stay, and so do rides on Strava. To keep a copy, download Your data from Settings on the TrainStack website first."
    guard AppleSignIn.isNative else { return warning }
    return warning
      + "\n\nApple then asks you to confirm, so Ride can end its Sign in with Apple access. If you cancel, the account is still deleted."
  }

  @ViewBuilder private var stravaSection: some View {
    Section {
      if !account.isSignedIn {
        Text("Sign in to connect Strava.").foregroundStyle(.secondary)
      } else if account.isStravaConnected {
        LabeledContent("Connected as", value: account.stravaAthleteName ?? "Strava athlete")
        Button("Disconnect", role: .destructive, action: disconnect).disabled(isWorking)
      } else {
        ConnectWithStravaButton(isWorking: isWorking, action: connect)
      }
    } header: {
      Text("Strava")
    } footer: {
      Text(
        account.isStravaConnected
          ? "Open a ride in History and choose Send to Strava. You can also revoke Ride's access in your Strava settings."
          : "Ride asks only to upload activities."
      )
    }
  }

  private func prepare(_ request: ASAuthorizationAppleIDRequest) {
    nonce = AppleSignInNonce()
    request.requestedScopes = [.fullName, .email]
    request.nonce = nonce.sha256ForApple
  }

  private func finish(_ result: Result<ASAuthorization, any Error>) {
    switch result {
    case .failure(let error):
      if (error as? ASAuthorizationError)?.code != .canceled {
        errorMessage = StravaError.signInFailed.localizedDescription
      }
    case .success(let authorization):
      guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
        let token = credential.identityToken.flatMap({ String(data: $0, encoding: .utf8) })
      else {
        errorMessage = StravaError.signInFailed.localizedDescription
        return
      }
      let name = credential.fullName.map { $0.formatted() }
      let code = credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
      run {
        try await account.signIn(
          identityToken: token, nonce: nonce.raw, fullName: name, authorizationCode: code)
      }
    }
  }

  private func signInThroughBrowser() {
    run {
      try await account.signInThroughBrowser { url in
        try await webAuthenticationSession.authenticate(
          using: url, callback: .customScheme(TrainStackClient.callbackScheme),
          preferredBrowserSession: .ephemeral, additionalHeaderFields: [:])
      }
    }
  }

  private func signOut() { run { await account.signOut() } }

  private func deleteAccount() {
    run { try await account.deleteAccount(askingAppleForAnAuthorizationCode: askAppleForACode) }
  }

  private func askAppleForACode() async throws -> String? {
    guard AppleSignIn.isNative else { return nil }
    let result = try await authorizationController.performRequest(
      ASAuthorizationAppleIDProvider().createRequest())
    guard case .appleID(let credential) = result else { return nil }
    return credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
  }

  private func disconnect() { run { try await account.disconnectStrava() } }

  private func connect() {
    run {
      try await account.connectStrava { url in
        try await webAuthenticationSession.authenticate(
          using: url, callback: .customScheme(TrainStackClient.callbackScheme),
          additionalHeaderFields: [:])
      }
    }
  }

  private func run(_ work: @escaping () async throws -> Void) {
    Task {
      isWorking = true
      defer { isWorking = false }
      do {
        try await work()
      } catch StravaError.cancelled {
      } catch {
        errorMessage = error.localizedDescription
      }
    }
  }

  private var errorShown: Binding<Bool> {
    Binding(
      get: { errorMessage != nil },
      set: { if !$0 { errorMessage = nil } })
  }
}

#Preview("Signed out") {
  NavigationStack { AccountSettingsView() }
    .environment(TrainStackAccount.signedOut)
    .frame(width: 500, height: 600)
}

#Preview("Signed in") {
  NavigationStack { AccountSettingsView() }
    .environment(TrainStackAccount.sample)
    .frame(width: 500, height: 600)
}
