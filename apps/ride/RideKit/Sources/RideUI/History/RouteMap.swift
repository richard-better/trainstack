import MapKit
import RideStrava
import SwiftUI

struct RouteMap: View {
  let route: AccountActivityDetail.Route

  private var tracks: [[CLLocationCoordinate2D]] {
    route.tracks.map { track in
      track.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
    }
  }

  private var region: MKCoordinateRegion {
    let points = tracks.joined()
    let latitudes = points.map(\.latitude)
    let longitudes = points.map(\.longitude)
    let south = latitudes.min() ?? 0
    let north = latitudes.max() ?? 0
    let west = longitudes.min() ?? 0
    let east = longitudes.max() ?? 0
    return MKCoordinateRegion(
      center: CLLocationCoordinate2D(latitude: (south + north) / 2, longitude: (west + east) / 2),
      span: MKCoordinateSpan(
        latitudeDelta: max((north - south) * 1.3, 0.005),
        longitudeDelta: max((east - west) * 1.3, 0.005)))
  }

  var body: some View {
    Map(initialPosition: .region(region), interactionModes: []) {
      ForEach(Array(tracks.enumerated()), id: \.offset) { _, track in
        MapPolyline(coordinates: track)
          .stroke(.orange, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
      }
    }
    .mapStyle(.standard(pointsOfInterest: .excludingAll))
    .frame(height: 240)
    .clipShape(.rect(cornerRadius: 12))
    .accessibilityLabel("Map of the route")
  }
}
