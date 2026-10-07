import RideData
import SwiftUI

/// A zone history entry: the day it takes effect from, which can be corrected, and its changes.
struct EntryRow: View {
  let entry: ZoneHistory.Entry
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      DatePicker("From", selection: day, in: ...Date.now, displayedComponents: .date)
        .bold()
      ForEach(entry.changes) { change in
        Text(change.summary)
          .font(.callout)
          .foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, 4)
  }

  /// Moving an entry records its changes afresh on the new day, as an entry of that day, so
  /// the day is read from this row's entry rather than looked up by its id.
  private var day: Binding<Date> {
    Binding(get: { entry.day }, set: { store.moveHistoryEntry(entry.id, to: $0) })
  }
}
