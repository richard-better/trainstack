import RideData
import SwiftUI

/// The library's filters, how many workouts pass them, and the sort order, as glass capsules
/// floating over the cards. One row when it fits, otherwise the same row scrolling sideways.
struct WorkoutFilterBar: View {
  @Binding var state: WorkoutsState
  /// How many workouts pass the filters.
  let count: Int

  /// The zones the library has workouts for, easiest first.
  static let zones = PowerZone.allCases.filter { zone in
    WorkoutTemplate.library.contains { $0.category == zone }
  }

  var body: some View {
    let filters = GlassEffectContainer(spacing: 8) {
      HStack(spacing: 8) {
        WorkoutFilterMenus(state: $state)
        Spacer()
        Text("^[\(count) workout](inflect: true)")
          .foregroundStyle(.secondary)
          .fixedSize()
          .padding(.horizontal, 4)
        sortMenu
      }
      .lineLimit(1)
      .padding(.horizontal, Design.wideContentMargin)
    }
    ViewThatFits(in: .horizontal) {
      filters
      ScrollView(.horizontal) { filters }
        .scrollIndicators(.hidden)
    }
    .padding(.vertical, 6)
  }

  private var sortMenu: some View {
    Menu {
      Picker("Sort", selection: $state.order) {
        ForEach(WorkoutOrder.allCases, id: \.self) { Text($0.title).tag($0) }
      }
      .pickerStyle(.inline)
    } label: {
      HStack(spacing: 5) {
        Text(state.order.title)
        Image(systemName: "chevron.down")
          .font(.caption2.weight(.bold))
          .foregroundStyle(.secondary)
      }
    }
    .menuIndicator(.hidden)
    .buttonStyle(.glass)
    .buttonBorderShape(.capsule)
    .font(.subheadline.weight(.semibold))
    .accessibilityLabel("Sort")
    .accessibilityValue(state.order.title)
    .help("Sort")
  }
}
