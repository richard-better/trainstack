import SwiftUI

extension KeyboardShortcut {
  var symbols: String {
    let modifierSymbols: [(EventModifiers, String)] = [
      (.control, "⌃"), (.option, "⌥"), (.shift, "⇧"), (.command, "⌘"),
    ]
    let modifiers = modifierSymbols.filter { self.modifiers.contains($0.0) }.map(\.1).joined()
    return modifiers + key.symbol
  }
}

extension KeyEquivalent {
  var symbol: String {
    switch self {
    case .space: "Space"
    case .upArrow: "↑"
    case .downArrow: "↓"
    case .leftArrow: "←"
    case .rightArrow: "→"
    case .return: "↩"
    case .escape: "⎋"
    case .delete: "⌫"
    case .tab: "⇥"
    default: String(character).uppercased()
    }
  }
}

extension View {
  func help(_ text: String, shortcut: KeyboardShortcut?) -> some View {
    help(shortcut.map { "\(text) (\($0.symbols))" } ?? text)
  }
}
