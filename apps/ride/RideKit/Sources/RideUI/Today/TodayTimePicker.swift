import SwiftUI

/// How long the rider has, as a segmented control, with a button to shuffle the suggestions.
/// The control keeps its natural width when there's room, otherwise it shares the row.
struct TodayTimePicker: View {
  @Binding var minutes: Int
  /// Whether the control always takes the width beside the button, as on iPhone.
  var fillsWidth = false
  let shuffle: () -> Void

  static let durations = [30, 45, 60, 75, 90, 120]

  var body: some View {
    Group {
      if fillsWidth {
        filledRow
      } else {
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 10) {
            picker.fixedSize()
            shuffleButton
          }
          filledRow
        }
      }
    }
    .monospacedDigit()
  }

  private var filledRow: some View {
    HStack(spacing: 10) {
      picker
      shuffleButton
    }
  }

  private var picker: some View {
    SegmentedPicker(
      title: "Time you have", options: Self.durations, selection: $minutes,
      label: { "\($0)m" })
  }

  private var shuffleButton: some View {
    Button("Other suggestions", systemImage: "shuffle", action: shuffle)
      .labelStyle(.iconOnly)
      .buttonStyle(.glass)
      .controlSize(.large)
      .help("Other suggestions")
  }
}
