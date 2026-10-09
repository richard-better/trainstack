import RideData
import RideStyle
import SwiftUI

/// The featured suggestion on a wide Today: a large profile, its kind of day, name and
/// summary, which open the workout, and a Start ride button, so it is clear what starts.
struct TodayHeroCard: View {
  let suggestion: TodaySuggestion

  var body: some View {
    let template = suggestion.template
    VStack(alignment: .leading, spacing: 0) {
      NavigationLink(value: template) {
        VStack(alignment: .leading, spacing: 0) {
          WorkoutProfile(template: template)
            .padding(.horizontal, 20)
            .padding(.top, 28)
            .frame(height: 220)
            .background(.primary.opacity(0.05))
          VStack(alignment: .leading, spacing: 6) {
            Text(suggestion.tag)
              .font(.subheadline.weight(.semibold))
              .foregroundStyle(.secondary)
            Text(template.name).font(.title.bold())
            HStack(spacing: 6) {
              Circle().fill(template.category.color).frame(width: 8, height: 8)
              Text(template.summary)
            }
            .font(.callout.monospacedDigit())
            .foregroundStyle(.secondary)
          }
          .padding([.horizontal, .top], 20)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
      }
      .buttonStyle(.plain)
      StartButton(template: template, title: "Start ride", isDefaultAction: false)
        .buttonStyle(.glassProminent)
        .controlSize(.extraLarge)
        .padding(20)
    }
    .background(.primary.opacity(0.04))
    .clipShape(.rect(cornerRadius: 22))
    .overlay {
      RoundedRectangle(cornerRadius: 22).strokeBorder(template.category.color, lineWidth: 2)
    }
  }
}
