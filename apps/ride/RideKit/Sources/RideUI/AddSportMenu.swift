import RideData
import SwiftUI

/// A menu of the sports not listed yet.
struct AddSportMenu: View {
  let added: (Sport) -> Void
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    let unlisted = Sport.allCases.filter { store.current.sports[$0] == nil }
    Menu("Add Sport", systemImage: "plus") {
      Section("Add zones for") {
        ForEach(unlisted, id: \.self) { sport in
          Button(sport.name) {
            store.setListed(true, sport)
            added(sport)
          }
        }
      }
    }
    .disabled(unlisted.isEmpty)
  }
}
