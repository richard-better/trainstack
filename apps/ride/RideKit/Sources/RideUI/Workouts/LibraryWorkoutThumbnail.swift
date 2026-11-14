import RideStrava
import SwiftUI

struct LibraryWorkoutThumbnail: View {
  let workout: LibraryWorkout
  let ftp: Int?

  var body: some View {
    if let planned = workout.planned {
      PlannedWorkoutProfile(workout: planned, ftp: ftp)
    } else {
      Image(systemName: "nosign")
        .font(.title3)
        .foregroundStyle(.tertiary)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityHidden(true)
    }
  }
}
