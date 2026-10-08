import RideData
import RideStyle
import SwiftUI

/// The featured suggestion: its kind of day, profile, name and summary, which open the
/// workout, then Start ride beneath, so it is clear what starts.
struct TodayPickCard: View {
  let suggestion: TodaySuggestion
  @ScaledMetric private var profileHeight = 84.0

  var body: some View {
    NavigationLink(value: suggestion.template) {
      VStack(alignment: .leading, spacing: 12) {
        Text(suggestion.tag)
          .font(.footnote.weight(.semibold))
          .foregroundStyle(.secondary)
        WorkoutProfile(template: suggestion.template)
          .frame(height: profileHeight)
          .overlay(alignment: .bottom) { Rectangle().fill(.separator).frame(height: 1) }
        VStack(alignment: .leading, spacing: 3) {
          Text(suggestion.template.name).font(.title3.weight(.semibold))
          HStack(spacing: 6) {
            Circle().fill(suggestion.template.category.color).frame(width: 8, height: 8)
            Text(suggestion.template.summary)
          }
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .monospacedDigit()
        }
      }
      .padding(.vertical, 6)
      .accessibilityElement(children: .combine)
    }
    .navigationLinkIndicatorVisibility(.hidden)
  }
}
