import SwiftUI

struct TodayHeader: View {
  var isCompact = false

  var body: some View {
    VStack(alignment: .leading, spacing: isCompact ? 2 : 4) {
      Text(Date.now, format: .dateTime.weekday(.wide).day().month(.wide))
        .font(isCompact ? .footnote.weight(.semibold) : .body)
        .foregroundStyle(.secondary)
      Text("Nothing planned")
        .font(isCompact ? .title3.weight(.semibold) : .title.bold())
      Text("Pick how long you have.")
        .font(isCompact ? .subheadline : .body)
        .foregroundStyle(.secondary)
    }
  }
}
