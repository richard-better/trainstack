import SwiftUI

struct FilterMenu<Value: Hashable, Choices: View>: View {
  let title: String
  @Binding var selection: Value
  let unfiltered: Value
  let choiceTitle: (Value) -> String
  @ViewBuilder let choices: Choices

  var body: some View {
    Menu {
      Picker(title, selection: $selection) { choices }
        .pickerStyle(.inline)
    } label: {
      HStack(spacing: 5) {
        Text(selection == unfiltered ? title : choiceTitle(selection))
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
