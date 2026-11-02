import SwiftUI

struct TodayTimePicker: View {
  @Binding var minutes: Int
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
