import Foundation
import RideBluetooth
import Testing

@testable import RideUI

struct SensorStatusTests {
  private let now = Date(timeIntervalSinceReferenceDate: 0)
  private let trainer = DiscoveredDevice(
    id: UUID(), name: "KICKR CORE", services: [.trainer, .power, .speedAndCadence])
  private let strap = DiscoveredDevice(id: UUID(), name: "Polar H10", services: [.heartRate])

  @Test func aConnectedSensorThatJustReportedIsLive() {
    #expect(SensorStatus.health(of: .connected, lastHeard: now - 1, at: now) == .live)
    #expect(SensorStatus.health(of: .connected, lastHeard: now - 5, at: now) == .live)
  }

  @Test func aConnectedSensorThatWentQuietIsFlagged() {
    #expect(SensorStatus.health(of: .connected, lastHeard: now - 5.5, at: now) == .quiet)
    #expect(SensorStatus.health(of: .connected, lastHeard: nil, at: now) == .quiet)
  }

  @Test func showsConnectingAndDisconnectedWhateverItLastSent() {
    #expect(SensorStatus.health(of: .connecting, lastHeard: now, at: now) == .connecting)
    #expect(SensorStatus.health(of: .disconnected, lastHeard: now, at: now) == .disconnected)
  }

  @Test func listsOnlyPairedDevicesAndTheWatchOnceItHasSent() {
    let nothing = SensorStatus.all(paired: [], watchLastHeard: nil, at: now)
    #expect(nothing.isEmpty)

    let statuses = SensorStatus.all(
      paired: [
        .init(device: strap, connection: .connecting, batteryLevel: 78),
        .init(device: trainer, connection: .connected, lastHeard: now - 1),
      ],
      watchLastHeard: nil, at: now)
    #expect(
      statuses == [
        .init(source: .trainer, name: "KICKR CORE", health: .live),
        .init(source: .heartRateStrap, name: "Polar H10", health: .connecting, batteryLevel: 78),
      ])
  }

  @Test func theWatchHasLongerBeforeItCountsAsQuiet() {
    let live = SensorStatus.all(paired: [], watchLastHeard: now - 8, at: now)
    #expect(live == [.init(source: .watch, name: "Apple Watch", health: .live)])
    let quiet = SensorStatus.all(paired: [], watchLastHeard: now - 11, at: now)
    #expect(quiet.map(\.health) == [.quiet])
  }

  @Test func aSeparatePowerMeterAndCadenceSensorEachGetTheirOwnStatus() {
    let meter = DiscoveredDevice(id: UUID(), name: "Assioma", services: [.power])
    let cadence = DiscoveredDevice(id: UUID(), name: "Wahoo RPM", services: [.speedAndCadence])
    let statuses = SensorStatus.all(
      paired: [
        .init(device: cadence, connection: .disconnected),
        .init(device: meter, connection: .connected, lastHeard: now - 9),
        .init(device: trainer, connection: .connected, lastHeard: now),
      ],
      watchLastHeard: now, at: now)
    #expect(statuses.map(\.source) == [.trainer, .powerMeter, .cadenceSensor, .watch])
    #expect(statuses.map(\.health) == [.live, .quiet, .disconnected, .live])
  }
}
