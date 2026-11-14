import SwiftUI

struct TodayHeader: View {
  var isCompact = false
  var plan: TodayPlan?

  var body: some View {
    VStack(alignment: .leading, spacing: isCompact ? 2 : 4) {
      Text(plan?.today.displayDate ?? .now, format: .dateTime.weekday(.wide).day().month(.wide))
        .font(isCompact ? .footnote.weight(.semibold) : .body)
        .foregroundStyle(.secondary)
      Text(plan?.headline ?? "Nothing planned")
        .font(isCompact ? .title3.weight(.semibold) : .title.bold())
      if plan == nil {
        Text("Pick how long you have.")
          .font(isCompact ? .subheadline : .body)
          .foregroundStyle(.secondary)
      }
    }
  }
}
