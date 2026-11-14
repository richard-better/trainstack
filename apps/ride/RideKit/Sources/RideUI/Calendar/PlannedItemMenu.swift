import RideStrava
import SwiftUI

struct PlannedItemMenu: View {
  let item: PlannedItem
  @Environment(AccountCalendar.self) private var calendar
  @Environment(\.choosePlannedItemAction) private var choose

  var body: some View {
    if item.state != .completed {
      if item.skipped == nil {
        Button("Skip…", systemImage: "forward.end") { choose(.skip(item)) }
      } else {
        Button("Don't Skip", systemImage: "arrow.uturn.backward") { calendar.unskip(item.id) }
      }
      Button("Move to Another Day…", systemImage: "calendar") { choose(.move(item)) }
    }
    if item.pairing != nil {
      Button("Unpair", systemImage: "link.badge.minus", role: .destructive) {
        choose(.unpair(item))
      }
    }
  }
}
