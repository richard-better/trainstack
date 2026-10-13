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
        WorkoutProgressChart(session: session, heartRateZones: controller.heartRateZones)
          .overlay {
            if let message = controller.trainerNotice
              ?? (session.isPaused ? PlayerBadge.paused : nil)
            {
              PlayerBadge(message: message)
            }
          }
      }
      .padding(.horizontal, Design.wideContentMargin)
      .padding(.top, 16)
      .padding(.bottom, 8)
      PlayerControls(controller: controller)
        .padding(.horizontal, Design.wideContentMargin)
        .frame(minHeight: 52)
      PlayerSecondaryStats(session: session)
        .padding(.horizontal, Design.wideContentMargin)
      PlayerTotals(totals: controller.totals)
        .padding(.horizontal, Design.wideContentMargin)
      PlayerNextInterval(controller: controller)
        .padding(.horizontal, Design.wideContentMargin)
      PlayerPrimaryStats(controller: controller)
        .padding(.horizontal, Design.wideContentMargin)
        .frame(maxHeight: .infinity)
    }
  }
}
