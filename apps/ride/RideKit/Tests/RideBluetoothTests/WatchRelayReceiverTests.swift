import Foundation
import Testing

@testable import RideBluetooth

@MainActor
struct WatchRelayReceiverTests {
  @Test func passesOnHeartRateFromRelays() {
    let (receiver, transport) = runningReceiver()
    var readings: [Int] = []
    receiver.onReading = { readings.append($0) }
    transport.onMeasurement?(UUID(), .init(beatsPerMinute: 152, hasContact: true))
    transport.onMeasurement?(UUID(), .init(beatsPerMinute: 154))
    #expect(readings == [152, 154])
  }

  @Test func ignoresMeasurementsWithoutAReading() {
    let (receiver, transport) = runningReceiver()
    var readings: [Int] = []
    receiver.onReading = { readings.append($0) }
    transport.onMeasurement?(UUID(), .init(beatsPerMinute: 0))
    transport.onMeasurement?(UUID(), .init(beatsPerMinute: 150, hasContact: false))
    #expect(readings.isEmpty)
  }

  @Test func stopsListeningWhenStopped() {
    let (receiver, transport) = runningReceiver()
    var readings: [Int] = []
    receiver.onReading = { readings.append($0) }
    receiver.stop()
    receiver.stop()
    #expect(transport.stops == 1)
    transport.onMeasurement?(UUID(), .init(beatsPerMinute: 150))
    #expect(readings.isEmpty)
    receiver.start()
    #expect(transport.starts == 2)
  }

  private func runningReceiver() -> (WatchRelayReceiver, FakeWatchRelayTransport) {
    let transport = FakeWatchRelayTransport()
    let receiver = WatchRelayReceiver(transport: transport)
    receiver.start()
    receiver.start()
    #expect(transport.starts == 1)
    return (receiver, transport)
  }
}

@MainActor
private final class FakeWatchRelayTransport: WatchRelayTransport {
  var onMeasurement: ((UUID, HeartRateMeasurement) -> Void)?
  var starts = 0
  var stops = 0

  func start() { starts += 1 }
  func stop() { stops += 1 }
}
