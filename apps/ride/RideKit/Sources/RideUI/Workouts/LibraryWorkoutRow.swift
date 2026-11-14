import RideStrava
import SwiftUI

struct LibraryWorkoutRow: View {
  let workout: LibraryWorkout
  let ftp: Int?
  @ScaledMetric private var profileHeight = 36.0

  var body: some View {
    HStack(spacing: 12) {
      LibraryWorkoutThumbnail(workout: workout, ftp: ftp)
        .frame(width: profileHeight * 2.1, height: profileHeight)
        .overlay(alignment: .bottom) { Rectangle().fill(.separator).frame(height: 1) }
      VStack(alignment: .leading, spacing: 2) {
        Text(workout.name).font(.body.weight(.semibold))
        Text(workout.summary(ftp: ftp))
          .font(.footnote)
          .foregroundStyle(.secondary)
          .monospacedDigit()
        if let why = workout.whyItCannotBeRidden {
          Label(why, systemImage: "exclamationmark.circle")
            .font(.footnote)
            .foregroundStyle(.orange)
        }
      }
    }
    .padding(.vertical, 1)
    .accessibilityElement(children: .combine)
  }
}
