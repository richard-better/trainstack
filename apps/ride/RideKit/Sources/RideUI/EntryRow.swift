import RideData
import SwiftUI

struct EntryRow: View {
  let entry: ZoneHistory.Entry
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      DatePicker("From", selection: day, in: ...Date.now, displayedComponents: .date)
        .fontWeight(.semibold)
      ForEach(entry.changes) { change in
        Text(change.summary)
          .font(.callout)
          .foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, 4)
  }

  private var day: Binding<Date> {
    Binding(get: { entry.day }, set: { store.moveHistoryEntry(entry.id, to: $0) })
  }
}
