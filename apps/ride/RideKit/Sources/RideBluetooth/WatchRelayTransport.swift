import Foundation

@MainActor
protocol WatchRelayTransport: AnyObject {
  var onMeasurement: ((UUID, HeartRateMeasurement) -> Void)? { get set }
  func start(claim: RideClaim?)
  func stop()
}
