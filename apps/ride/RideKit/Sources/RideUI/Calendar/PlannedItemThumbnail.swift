import RideStrava
import SwiftUI

struct PlannedItemThumbnail: View {
  let item: PlannedItem
  let ftp: Int?

  var body: some View {
    if let planned = item.playable {
      PlannedWorkoutProfile(workout: planned, ftp: ftp)
    } else {
      Image(systemName: item.isWorkout ? "nosign" : item.symbol)
        .font(.title3)
        .foregroundStyle(.tertiary)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityHidden(true)
    }
  }
}
