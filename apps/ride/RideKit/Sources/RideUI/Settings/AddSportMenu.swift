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
          Button(sport.name) { add(sport) }
        }
      }
    }
    .disabled(unlisted.isEmpty)
  }

  private func add(_ sport: Sport) {
    store.setListed(true, sport)
    added(sport)
  }
}
