import SwiftUI

/// A filter as a capsule naming what it filters by, or its choice once one is made. Its menu
/// lists the choices.
struct FilterMenu<Value: Hashable, Choices: View>: View {
  let title: String
  @Binding var selection: Value
  /// The choice that filters nothing.
  let any: Value
  let choiceTitle: (Value) -> String
  @ViewBuilder let choices: Choices

  var body: some View {
    Menu {
      Picker(title, selection: $selection) { choices }
        .pickerStyle(.inline)
    } label: {
      HStack(spacing: 5) {
        Text(selection == any ? title : choiceTitle(selection))
        Image(systemName: "chevron.down")
          .font(.caption2.weight(.bold))
          .foregroundStyle(.secondary)
      }
    }
    .menuIndicator(.hidden)
    .buttonStyle(.glass)
    .buttonBorderShape(.capsule)
    .font(.subheadline.weight(.semibold))
    .accessibilityLabel(title)
    .accessibilityValue(choiceTitle(selection))
  }
}
