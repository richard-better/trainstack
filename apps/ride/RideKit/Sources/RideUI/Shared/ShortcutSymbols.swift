import SwiftUI

extension KeyboardShortcut {
  /// The keys as a menu writes them, such as ⇧⌘E, for help tags.
  var symbols: String {
    let modifierSymbols: [(EventModifiers, String)] = [
      (.control, "⌃"), (.option, "⌥"), (.shift, "⇧"), (.command, "⌘"),
    ]
    let modifiers = modifierSymbols.filter { self.modifiers.contains($0.0) }.map(\.1).joined()
    return modifiers + key.symbol
  }
}

extension KeyEquivalent {
  /// The key as a menu writes it.
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
  /// A help tag that names the keys for `shortcut` too, such as "Pause (Space)".
  func help(_ text: String, shortcut: KeyboardShortcut?) -> some View {
    help(shortcut.map { "\(text) (\($0.symbols))" } ?? text)
  }
}
