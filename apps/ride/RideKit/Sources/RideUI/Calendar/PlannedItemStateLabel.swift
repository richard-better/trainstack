import RideStrava
import SwiftUI

struct PlannedItemStateLabel: View {
  let item: PlannedItem

  var body: some View {
    if let label = item.stateLabel {
      Label(label, systemImage: symbol)
        .foregroundStyle(color)
    }
  }

  private var symbol: String {
    switch item.state {
    case .completed: "checkmark.circle.fill"
    case .skipped: "forward.end.circle"
    case .missed: "exclamationmark.circle"
    case .planned: "circle"
    }
  }

  private var color: Color {
    switch item.state {
    case .completed: .green
    case .missed: .orange
    case .skipped, .planned: .secondary
    }
  }
}
