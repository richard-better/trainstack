import RideStrava
import SwiftUI

struct PlannedItemActions: ViewModifier {
  @Environment(AccountCalendar.self) private var calendar
  @State private var sheet: PlannedItemAction?
  @State private var unpairing: PlannedItem?

  func body(content: Content) -> some View {
    content
      .environment(\.choosePlannedItemAction, ChoosePlannedItemAction(choose))
      .sheet(item: $sheet) { action in
        switch action {
        case .skip(let item): PlannedItemSkipSheet(item: item)
        case .move(let item): PlannedItemMoveSheet(item: item)
        case .unpair: EmptyView()
        }
      }
      .confirmationDialog(
        "Unpair this ride?", isPresented: unpairingShown, titleVisibility: .visible,
        presenting: unpairing
      ) { item in
        Button("Unpair", role: .destructive) { calendar.unpair(item.id) }
      } message: { _ in
        Text(
          "The workout and the activity are taken apart, and are not matched again by themselves.")
      }
  }

  private func choose(_ action: PlannedItemAction) {
    if case .unpair(let item) = action {
      unpairing = item
    } else {
      sheet = action
    }
  }

  private var unpairingShown: Binding<Bool> {
    Binding(get: { unpairing != nil }, set: { if !$0 { unpairing = nil } })
  }
}

extension View {
  func plannedItemActions() -> some View { modifier(PlannedItemActions()) }
}
