import SwiftUI

struct ConnectWithStravaButton: View {
  private static let stravaOrange = Color(red: 252 / 255, green: 76 / 255, blue: 2 / 255)
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
    .tint(Self.stravaOrange)
    .disabled(isWorking)
  }
}
