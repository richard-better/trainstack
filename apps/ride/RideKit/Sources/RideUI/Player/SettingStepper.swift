import SwiftUI

/// − value +, for the setting of the current trainer mode. The up and down arrow keys work
/// too, as do the Controls menu's shortcuts.
struct SettingStepper: View {
  let label: String
  let decrease: () -> Void
  let increase: () -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    HStack(spacing: 0) {
      Button(action: decrease) {
        Label("Decrease", systemImage: "minus").minimumTapTarget()
      }
      .keyboardShortcut(.downArrow, modifiers: [])
      Text(label)
        .frame(minWidth: 64)
        .contentTransition(.numericText())
        .animation(reduceMotion ? nil : .default, value: label)
      Button(action: increase) {
        Label("Increase", systemImage: "plus").minimumTapTarget()
      }
      .keyboardShortcut(.upArrow, modifiers: [])
    }
    .labelStyle(.iconOnly)
    .buttonStyle(.borderless)
    .padding(.horizontal, 4)
    #if os(macOS)
      .frame(height: 32)
    #endif
    .glassEffect(.regular.interactive(), in: .capsule)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Trainer setting")
    .accessibilityValue(label)
    .accessibilityAdjustableAction { direction in
      switch direction {
      case .increment: increase()
      case .decrement: decrease()
      @unknown default: break
      }
    }
    .help("\(keys(for: .decrease, arrow: "↓")), \(keys(for: .increase, arrow: "↑").lowercased())")
  }

  /// Such as "Harder (↑ or ⌘+)".
  private func keys(for command: RideCommand, arrow: String) -> String {
    let menu = command.shortcut(playerPresented: true).map { " or \($0.symbols)" } ?? ""
    return "\(command.title(in: nil)) (\(arrow)\(menu))"
  }
}
