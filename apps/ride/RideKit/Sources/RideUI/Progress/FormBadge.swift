import SwiftUI

/// What form means for the next ride, as a coloured label.
struct FormBadge: View {
  let form: Double

  var body: some View {
    HStack(spacing: 5) {
      Circle().fill(state.color).frame(width: 6, height: 6)
      Text(state.title)
    }
    .font(.caption)
    .padding(.horizontal, 8)
    .padding(.vertical, 2)
    .background(.quaternary.opacity(0.6), in: .capsule)
  }

  private var state: (title: String, color: Color) {
    switch form {
    case 5...: ("Well recovered", .green)
    case -10..<5: ("Balanced", .gray)
    case -30 ..< -10: ("Building", .yellow)
    default: ("Overreaching", .red)
    }
  }
}
