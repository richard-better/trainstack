import RideStrava
import SwiftUI

struct PlannedItemSkipSheet: View {
  let item: PlannedItem
  @Environment(AccountCalendar.self) private var calendar
  @Environment(\.dismiss) private var dismiss
  @State private var reason = ""

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Why, if you like", text: $reason, axis: .vertical)
            .lineLimit(2...4)
        } footer: {
          Text("It stays on the calendar as skipped, on every device and on the web.")
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Skip \(item.title)")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Skip") {
            calendar.skip(item.id, reason: String(reason.prefix(500)))
            dismiss()
          }
        }
      }
    }
    #if os(macOS)
      .frame(minWidth: 380, minHeight: 220)
    #endif
  }
}
