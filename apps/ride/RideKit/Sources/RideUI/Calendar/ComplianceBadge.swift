import RideStrava
import SwiftUI

struct ComplianceBadge: View {
  let words: ComplianceWords
  var withWhy = true

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      headline
        .foregroundStyle(color)
        .fixedSize(horizontal: false, vertical: true)
      if withWhy {
        Text(words.why)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .accessibilityElement(children: .combine)
    .help(words.why)
  }

  private var headline: Text {
    let score = words.score.map { Text(" \($0)").bold().monospacedDigit() } ?? Text("")
    let soFar = words.provisional ? Text(" so far").foregroundStyle(.secondary) : Text("")
    return Text("\(Image(systemName: symbol))\(score) \(words.label)\(soFar)")
  }

  private var symbol: String {
    switch words.rating {
    case .onTarget?: "circle.fill"
    case .partly?: "circle.lefthalf.filled"
    case .offTarget?: "circle"
    case nil: "circle.dashed"
    }
  }

  private var color: Color {
    switch words.rating {
    case .onTarget?: .green
    case .partly?: .orange
    case .offTarget?: .red
    case nil: .secondary
    }
  }
}
