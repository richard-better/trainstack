import SwiftUI

/// Strava's brand guidelines ask for their own "Connect with Strava" artwork. This stands in for
/// it, in their orange, until the artwork is added for the app's review by Strava.
struct ConnectWithStravaButton: View {
  var isWorking = false
  var action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 8) {
        if isWorking { ProgressView().controlSize(.small) }
        Text("Connect with Strava").bold()
      }
      .frame(maxWidth: .infinity)
    }
    .buttonStyle(.borderedProminent)
    .tint(Color(red: 252 / 255, green: 76 / 255, blue: 2 / 255))
    .disabled(isWorking)
  }
}
