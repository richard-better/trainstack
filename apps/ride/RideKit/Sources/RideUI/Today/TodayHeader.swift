import SwiftUI

/// Today's date, and an invitation to ride since nothing is planned.
struct TodayHeader: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(Date.now, format: .dateTime.weekday(.wide).day().month(.wide))
        .foregroundStyle(.secondary)
      Text("Nothing planned")
        .font(.title)
        .bold()
      Text("Feel like riding? Pick how long you have.")
        .foregroundStyle(.secondary)
    }
  }
}
