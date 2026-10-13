import RideData
import RideStyle
import SwiftUI

/// The workout a ride followed, as a compact card: its profile coloured by zone, its name and
/// what it asks for. Click to open the workout.
struct RideWorkoutCard: View {
  let template: WorkoutTemplate
  @Environment(\.openWorkout) private var openWorkout

  var body: some View {
    Button {
      openWorkout(template)
    } label: {
      HStack(spacing: 14) {
        WorkoutProfile(template: template)
          .padding(.horizontal, 8)
          .padding(.top, 8)
          .frame(width: 132, height: 52)
          .background(.primary.opacity(0.05))
          .clipShape(.rect(cornerRadius: 8))
        VStack(alignment: .leading, spacing: 4) {
          Text(template.name).font(.headline).lineLimit(1)
          HStack(spacing: 6) {
            Circle().fill(template.category.color).frame(width: 7, height: 7)
            Text(template.summary)
          }
          .font(.caption.monospacedDigit())
          .foregroundStyle(.secondary)
        }
        Spacer(minLength: 0)
        Image(systemName: "chevron.forward")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.tertiary)
      }
      .padding(10)
      .background(.primary.opacity(0.04))
      .clipShape(.rect(cornerRadius: 14))
      .overlay {
        RoundedRectangle(cornerRadius: 14).strokeBorder(.primary.opacity(0.06))
      }
      .contentShape(.rect(cornerRadius: 14))
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Workout \(template.name)")
    .accessibilityValue(template.summary)
    .accessibilityHint("Opens the workout")
  }
}

#Preview {
  RideWorkoutCard(template: .named("Threshold classic 60")!)
    .frame(width: 420)
    .padding()
}
