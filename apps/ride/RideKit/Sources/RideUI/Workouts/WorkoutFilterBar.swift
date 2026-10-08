import RideData
import SwiftUI

/// The library's filters, how many workouts pass them, and the sort order. One row when it
/// fits, otherwise the same row scrolling sideways.
struct WorkoutFilterBar: View {
  @Binding var state: WorkoutsState
  /// How many workouts pass the filters.
  let count: Int

  /// The zones the library has workouts for, easiest first.
  static let zones = PowerZone.allCases.filter { zone in
    WorkoutTemplate.library.contains { $0.category == zone }
  }

  var body: some View {
    let filters = HStack(spacing: 8) {
      Picker("Duration", selection: $state.duration) {
        ForEach(WorkoutDurationFilter.allCases, id: \.self) { Text($0.title).tag($0) }
      }
      .fixedSize()
      Picker("Zone", selection: $state.zone) {
        Text("Any zone").tag(PowerZone?.none)
        Divider()
        ForEach(Self.zones, id: \.self) { Text($0.name).tag(Optional($0)) }
      }
      .fixedSize()
      Picker("Stress", selection: $state.stress) {
        ForEach(WorkoutStressFilter.allCases, id: \.self) { Text($0.title).tag($0) }
      }
      .fixedSize()
      Spacer()
      Text("^[\(count) workout](inflect: true)")
        .foregroundStyle(.secondary)
        .fixedSize()
      Picker("Sort", selection: $state.order) {
        ForEach(WorkoutOrder.allCases, id: \.self) { Text($0.title).tag($0) }
      }
      .fixedSize()
      .help("Sort")
    }
    .pickerStyle(.menu)
    .labelsHidden()
    .font(.callout)
    #if os(macOS)
      .controlSize(.small)
    #endif
    .padding(.horizontal, Design.wideContentMargin)
    ViewThatFits(in: .horizontal) {
      filters
      ScrollView(.horizontal) { filters }
        .scrollIndicators(.hidden)
    }
    .frame(minHeight: 44)
  }
}
