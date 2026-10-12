import AuthenticationServices
import RideStrava
import SwiftUI

/// The TrainStack account and Strava. Ride works without either; an account is only for sending
/// rides to Strava.
struct AccountSettingsView: View {
  @Environment(TrainStackAccount.self) private var account
  @Environment(\.webAuthenticationSession) private var webAuthenticationSession
  @State private var nonce = AppleSignInNonce()
  @State private var isWorking = false
  @State private var isConfirmingDelete = false
  @State private var errorMessage: String?

  var body: some View {
    Form {
      accountSection
      stravaSection
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
      Text(
        "This deletes your TrainStack account and its Strava connection. Your rides stay on this device and on Strava."
      )
    }
  }

  @ViewBuilder private var accountSection: some View {
    Section {
      if account.isSignedIn {
        LabeledContent("Signed in as", value: account.name ?? "Apple account")
        Button("Sign Out", action: signOut).disabled(isWorking)
        Button("Delete Account…", role: .destructive) { isConfirmingDelete = true }
          .disabled(isWorking)
      } else {
        SignInWithAppleButton(.signIn, onRequest: prepare, onCompletion: finish)
          .frame(height: 44)
      }
    } header: {
      Text("TrainStack account")
    } footer: {
      Text(
        account.isSignedIn
          ? "Your account holds your Strava connection and nothing else. Your rides stay on this device."
          : "Ride works without an account. You only need one to send rides to Strava."
      )
    }
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

  // MARK: Actions

  private func prepare(_ request: ASAuthorizationAppleIDRequest) {
    nonce = AppleSignInNonce()
    request.requestedScopes = [.fullName, .email]
    request.nonce = nonce.hashed
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
      run { try await account.signIn(identityToken: token, nonce: nonce.raw, fullName: name) }
    }
  }

  private func signOut() { run { await account.signOut() } }

  private func deleteAccount() { run { try await account.deleteAccount() } }

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

  /// Does `work` with the buttons held, and shows what went wrong unless the rider backed out.
  private func run(_ work: @escaping () async throws -> Void) {
    Task {
      isWorking = true
      defer { isWorking = false }
      do {
        try await work()
      } catch StravaError.cancelled {
        // The rider backed out, which needs no explaining.
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
