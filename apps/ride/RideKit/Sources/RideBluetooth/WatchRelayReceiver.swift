import Foundation

@MainActor
protocol WatchRelayTransport: AnyObject {
  /// A Heart Rate Measurement from a connected relay.
  var onMeasurement: ((UUID, HeartRateMeasurement) -> Void)? { get set }
  /// Finds and connects to every relaying iPhone in range, and reconnects any that drop out,
  /// once Bluetooth is ready.
  func start()
  func stop()
}

/// Heart rate from an Apple Watch, passed on by an iPhone running Ride's `HeartRateRelay`. Runs
/// only while a ride is on, and needs no pairing: Ride on the iPhone advertises its own service,
/// so nothing else is connected to.
@MainActor
public final class WatchRelayReceiver {
  /// Called with each heart rate a relay sends.
  public var onReading: ((Int) -> Void)?
  private let transport: any WatchRelayTransport
  private var isRunning = false

  public convenience init() { self.init(transport: CoreBluetoothWatchRelay()) }

  init(transport: any WatchRelayTransport) {
    self.transport = transport
    transport.onMeasurement = { [weak self] _, measurement in self?.receive(measurement) }
  }

  public func start() {
    guard !isRunning else { return }
    isRunning = true
    transport.start()
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
