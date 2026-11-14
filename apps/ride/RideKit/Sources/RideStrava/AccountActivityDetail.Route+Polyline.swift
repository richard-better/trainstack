extension AccountActivityDetail.Route {
  public var tracks: [[(latitude: Double, longitude: Double)]] {
    segments.map(Self.decode).filter { $0.count > 1 }
  }

  static func decode(_ polyline: String) -> [(latitude: Double, longitude: Double)] {
    var points: [(latitude: Double, longitude: Double)] = []
    var bytes = polyline.utf8.makeIterator()
    var latitude = 0
    var longitude = 0
    func next() -> Int? {
      var result = 0
      var shift = 0
      while let byte = bytes.next() {
        let chunk = Int(byte) - 63
        guard chunk >= 0, shift < 32 else { return nil }
        result |= (chunk & 0x1F) << shift
        shift += 5
        if chunk < 0x20 { return (result & 1) != 0 ? ~(result >> 1) : result >> 1 }
      }
      return nil
    }
    while let deltaLatitude = next(), let deltaLongitude = next() {
      latitude += deltaLatitude
      longitude += deltaLongitude
      points.append((Double(latitude) / 1e5, Double(longitude) / 1e5))
    }
    return points
  }
}
