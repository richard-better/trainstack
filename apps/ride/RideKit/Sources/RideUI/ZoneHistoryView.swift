import RideData
import SwiftUI

/// Every change to the rider's zones, newest first. Each entry's day can be corrected, and an
/// entry can be deleted.
struct ZoneHistoryView: View {
  @Environment(RiderSettingsStore.self) private var store
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List {
        ForEach(store.historyEntries.reversed()) { entry in
          EntryRow(entry: entry)
            .contextMenu {
              Button("Delete", role: .destructive) { store.removeHistoryEntry(entry.id) }
            }
            .swipeActions {
              Button("Delete", role: .destructive) { store.removeHistoryEntry(entry.id) }
            }
        }
      }
      .safeAreaInset(edge: .bottom) {
        Text(
          "Each activity uses the zones in effect on its day. A change holds until a later change to the same setting, and activities from before the first change use the earliest zones."
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
      }
      .overlay {
        if store.historyEntries.isEmpty {
          ContentUnavailableView(
            "No Changes Yet", systemImage: "clock.arrow.circlepath",
            description: Text("Changes to your thresholds and zones will show here."))
        }
      }
      .navigationTitle("Zone History")
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
    }
    #if os(macOS)
      // A sheet on macOS is only as big as its content asks for.
      .frame(minWidth: 480, minHeight: 420)
    #endif
  }
}

private struct EntryRow: View {
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
