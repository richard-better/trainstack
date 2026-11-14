import SwiftUI

struct HistoryRow: View {
  let entry: HistoryEntry
  let library: RideLibrary

  var body: some View {
    if let activity = entry.activity, activity.isSummarized || entry.ride == nil {
      AccountActivityRow(
        activity: activity, isOnStrava: entry.ride.map(library.isOnStrava) ?? false)
    } else if let ride = entry.ride {
      RideRow(ride: ride, isOnStrava: library.isOnStrava(ride))
    }
  }
}
