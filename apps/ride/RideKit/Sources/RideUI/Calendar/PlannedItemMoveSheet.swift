import RideData
import RideStrava
import SwiftUI

struct PlannedItemMoveSheet: View {
  let item: PlannedItem
  @Environment(AccountCalendar.self) private var calendar
  @Environment(\.dismiss) private var dismiss
  @State private var date = Date.now

  var body: some View {
    NavigationStack {
      Form {
        DatePicker("Day", selection: $date, displayedComponents: .date)
          .datePickerStyle(.graphical)
      }
      .formStyle(.grouped)
      .navigationTitle("Move \(item.title)")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Move") {
            calendar.move(item.id, to: SettingDay(date))
            dismiss()
          }
          .disabled(SettingDay(date) == item.day)
        }
      }
    }
    .onAppear { date = item.day.displayDate }
    #if os(macOS)
      .frame(minWidth: 380, minHeight: 420)
    #endif
  }
}
