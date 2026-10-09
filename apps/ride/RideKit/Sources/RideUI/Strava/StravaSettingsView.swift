import AuthenticationServices
import RideStrava
import SwiftUI

/// Signing in to Strava, so finished rides can be sent there.
struct StravaSettingsView: View {
  @Environment(StravaConnection.self) private var strava
  @Environment(\.webAuthenticationSession) private var webAuthenticationSession
  @State private var isWorking = false
  @State private var errorMessage: String?

  var body: some View {
    Form {
      Section {
        if strava.isConnected {
          LabeledContent("Signed in as", value: strava.athleteName ?? "Strava athlete")
          Button("Disconnect", role: .destructive, action: disconnect)
            .disabled(isWorking)
        } else {
          ConnectWithStravaButton(isWorking: isWorking, action: connect)
        }
      } footer: {
        Text(
          strava.isConnected
            ? "Open a ride in History and choose Send to Strava. You can also revoke Ride's access in your Strava settings."
            : "Ride can send your finished rides to Strava. It asks only to upload activities, and keeps your sign-in on this device."
        )
      }
      Section {
        Text("Compatible with Strava")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
    .navigationTitle("Strava")
    .alert("Couldn't Connect to Strava", isPresented: errorShown) {
      Button("OK") {}
    } message: {
      Text(errorMessage ?? "")
    }
  }

  private func connect() {
    Task {
      isWorking = true
      defer { isWorking = false }
      do {
        try await strava.connect { url in
          try await webAuthenticationSession.authenticate(
            using: url, callback: .customScheme(StravaSignIn.callbackScheme),
            additionalHeaderFields: [:])
        }
      } catch StravaError.denied {
        // The rider backed out, which needs no explaining.
      } catch {
        errorMessage = error.localizedDescription
      }
    }
  }

  private func disconnect() {
    Task {
      isWorking = true
      defer { isWorking = false }
      await strava.disconnect()
    }
  }

  private var errorShown: Binding<Bool> {
    Binding(
      get: { errorMessage != nil },
      set: { if !$0 { errorMessage = nil } })
  }
}

#Preview("Signed out") {
  NavigationStack { StravaSettingsView() }
    .environment(StravaConnection(store: InMemoryStravaTokenStore()))
    .frame(width: 500, height: 400)
}

#Preview("Signed in") {
  NavigationStack { StravaSettingsView() }
    .environment(StravaConnection.sample)
    .frame(width: 500, height: 400)
}
