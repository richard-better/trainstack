import SwiftUI

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
