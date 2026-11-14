import RideStrava
import SwiftUI

struct RouteSection: View {
  let activity: AccountActivity
  @Environment(AccountHistory.self) private var history

  var body: some View {
    if let route = history.detail(of: activity.id)?.route, !route.tracks.isEmpty {
      RouteMap(route: route)
    }
  }
}
