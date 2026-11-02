import Foundation

@MainActor
public final class WatchRelayReceiver {
  public var onReading: ((Int) -> Void)?
  private let transport: any WatchRelayTransport
  private var isRunning = false

  public convenience init() { self.init(transport: CoreBluetoothWatchRelay()) }

  init(transport: any WatchRelayTransport) {
    self.transport = transport
    transport.onMeasurement = { [weak self] _, measurement in self?.receive(measurement) }
  }

  public func start(claim: RideClaim? = nil) {
    guard !isRunning else { return }
    isRunning = true
    transport.start(claim: claim)
  }

  public func stop() {
    guard isRunning else { return }
    isRunning = false
    transport.stop()
  }

  private func receive(_ measurement: HeartRateMeasurement) {
    guard isRunning, let bpm = measurement.reading else { return }
    onReading?(bpm)
  }
}
