import SwiftUI

/// A segmented choice between a few options: a glass control on macOS, where the system one
/// would draw a flat slab beside glass controls, and the system segmented picker elsewhere.
struct SegmentedPicker<Value: Hashable>: View {
  let title: String
  let options: [Value]
  @Binding var selection: Value
  let label: (Value) -> String

  var body: some View {
    #if os(macOS)
      GlassSegmentedControl(title: title, options: options, selection: $selection, label: label)
    #else
      Picker(title, selection: $selection) {
        ForEach(options, id: \.self) { Text(label($0)).tag($0) }
      }
      .pickerStyle(.segmented)
      .labelsHidden()
    #endif
  }
}
