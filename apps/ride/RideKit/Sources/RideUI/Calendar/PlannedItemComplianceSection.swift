import RideStrava
import SwiftUI

struct PlannedItemComplianceSection: View {
  let item: PlannedItem
  let done: CalendarActivity?

  var body: some View {
    if let words = ComplianceWords(item) {
      Section {
        ComplianceBadge(words: words)
          .font(.subheadline)
        ForEach(words.parts) { part in
          VStack(alignment: .leading, spacing: 2) {
            HStack {
              Text(part.name).font(.subheadline.weight(.semibold))
              Spacer()
              Text(
                part.key == .intervals
                  ? "\(part.done) of \(part.planned) in target"
                  : "\(part.done) of \(part.planned)"
              )
              .monospacedDigit()
            }
            Text(part.verdict).foregroundStyle(.secondary)
          }
          .font(.subheadline)
          .accessibilityElement(children: .combine)
        }
        ForEach(words.unscored, id: \.self) { line in
          Text(line).font(.footnote).foregroundStyle(.secondary)
        }
      } header: {
        Text("How it went")
      } footer: {
        if let done {
          Text(
            "\(item.pairing?.by == .athlete ? "You paired it with" : "Matched with") \(done.title), \(done.summary)."
          )
        }
      }
    }
  }
}
