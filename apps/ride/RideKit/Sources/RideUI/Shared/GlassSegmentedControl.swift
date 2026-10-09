import SwiftUI

/// A segmented control on a glass track. The chosen segment is lit in the accent colour, and
/// the light slides to the one picked. Used where macOS's own segmented control would draw a
/// flat slab among glass controls.
struct GlassSegmentedControl<Value: Hashable>: View {
  let title: String
  let options: [Value]
  @Binding var selection: Value
  let label: (Value) -> String
  @Namespace private var indicator
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    HStack(spacing: 2) {
      ForEach(options, id: \.self) { option in
        let isSelected = option == selection
        Button {
          select(option)
        } label: {
          Text(label(option))
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .foregroundStyle(isSelected ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .background {
              if isSelected {
                Capsule()
                  .fill(.tint)
                  .matchedGeometryEffect(id: "selected", in: indicator)
              }
            }
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
      }
    }
    .padding(3)
    .glassEffect(.regular, in: .capsule)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(title)
  }

  private func select(_ option: Value) {
    withAnimation(reduceMotion ? nil : .smooth(duration: 0.25)) { selection = option }
  }
}
