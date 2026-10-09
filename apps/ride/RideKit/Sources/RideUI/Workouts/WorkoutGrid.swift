import RideData
import SwiftUI

/// Workout cards in as many columns as fit. Click to select, double-click to open.
struct WorkoutGrid: View {
  @Binding var state: WorkoutsState
  let shown: [WorkoutTemplate]
  @Environment(\.openWorkout) private var openWorkout
  @Environment(RideLauncher.self) private var launcher
  @Environment(RiderSettingsStore.self) private var settings

  var body: some View {
    ScrollView {
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 14)], spacing: 14) {
        ForEach(shown) { template in
          WorkoutCard(
            template: template, isSelected: template.id == state.selection,
            select: { state.selection = template.id },
            open: { openWorkout(template) },
            start: settings.ftp.map { ftp in
              { launcher.start(template, ftp: ftp, heartRateZones: settings.heartRateZones) }
            })
        }
      }
      .padding(Design.wideContentMargin)
    }
  }
}
