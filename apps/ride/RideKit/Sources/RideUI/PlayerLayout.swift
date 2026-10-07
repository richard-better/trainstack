import RideData
import SwiftUI

/// The player's chart, controls and numbers, top to bottom.
struct PlayerLayout: View {
  let controller: RideController

  var body: some View {
    let session = controller.session
    VStack(spacing: 0) {
      VStack(alignment: .leading, spacing: 8) {
        PlayerChartHeader(controller: controller)
        WorkoutProgressChart(session: session)
          .overlay { if session.isPaused { PausedBadge() } }
      }
      .padding(.horizontal, 24)
      .padding(.top, 16)
      .padding(.bottom, 8)
      PlayerControls(controller: controller)
        .padding(.horizontal, 24)
        .frame(minHeight: 52)
      PlayerSecondaryStats(session: session)
        .padding(.horizontal, 24)
      PlayerPrimaryStats(controller: controller)
        .padding(.horizontal, 24)
        .frame(maxHeight: .infinity)
    }
  }
}
