import RideData
import SwiftUI

/// In place of fitness and form, which need an FTP, a way to add one, beside this week's
/// riding.
struct NoFTPHeadline: View {
  let rides: [RideRecording]
  let openSettings: () -> Void

  var body: some View {
    let message = VStack(alignment: .leading, spacing: 3) {
      Text("Fitness").font(.caption).foregroundStyle(.secondary)
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 4) { messageContent }
        VStack(alignment: .leading, spacing: 0) { messageContent }
      }
      .font(.callout)
      .foregroundStyle(.secondary)
    }
    .padding(.vertical, 14)
    .frame(maxWidth: .infinity, alignment: .leading)
    let thisWeek = ThisWeekStat(rides: rides)
    ViewThatFits(in: .horizontal) {
      DividedRow(spacing: 16) {
        message
        thisWeek.frame(maxWidth: 260, alignment: .leading)
      }
      VStack(alignment: .leading, spacing: 0) {
        message
        Divider()
        thisWeek
      }
    }
    .overlay(alignment: .top) { Divider() }
    .overlay(alignment: .bottom) { Divider() }
  }

  @ViewBuilder private var messageContent: some View {
    Text("Fitness and form are worked out from power.")
    Button("Add your FTP in Settings", action: openSettings).inlineLinkStyle()
  }
}
