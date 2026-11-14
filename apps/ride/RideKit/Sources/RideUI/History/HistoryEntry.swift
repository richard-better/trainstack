import Foundation
import RideStrava

struct HistoryEntry: Identifiable {
  let id: String
  let ride: Ride?
  let activity: AccountActivity?

  var date: Date { activity?.date ?? ride?.recording.startDate ?? .distantPast }

  static func merging(rides: [Ride], account activities: [AccountActivity]) -> [HistoryEntry] {
    let rideByID = Dictionary(rides.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    let listed = Set(activities.map(\.id))
    let fromTheAccount = activities.filter(\.primary).map {
      HistoryEntry(id: $0.id, ride: rideByID[$0.id], activity: $0)
    }
    let onlyHere = rides.filter { !listed.contains($0.id) }.map {
      HistoryEntry(id: $0.id, ride: $0, activity: nil)
    }
    return (fromTheAccount + onlyHere).sorted {
      $0.date != $1.date ? $0.date > $1.date : $0.id < $1.id
    }
  }
}
