import Testing

@testable import RideStrava

struct RoutePolylineTests {
  @Test func decodesARouteAsGoogleEncodesIt() {
    let route = AccountActivityDetail.Route(segments: ["_p~iF~ps|U_ulLnnqC_mqNvxq`@", "??", ""])
    let tracks = route.tracks
    #expect(tracks.count == 1)
    #expect(tracks[0].map(\.latitude) == [38.5, 40.7, 43.252])
    #expect(tracks[0].map(\.longitude) == [-120.2, -120.95, -126.453])
  }
}
