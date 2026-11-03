import Foundation
import Testing

@testable import RideBluetooth

@MainActor
struct BluetoothRecordingTests {
  private let trainer = DiscoveredDevice(
    id: UUID(), name: "KICKR CORE", services: [.trainer, .power])
  private let strap = DiscoveredDevice(id: UUID(), name: "Polar H10", services: [.heartRate])

  @MainActor
  private final class Bench {
    var now = Date(timeIntervalSinceReferenceDate: 815_000_000)
    let transport = FakeTransport()
    var devices: BluetoothDevices!
    var liveTicks: [BluetoothReplay.Tick] = []
    var answered = 0

    init() {
      devices = BluetoothDevices(transport: transport, defaults: isolatedDefaults()) {
        [unowned self] in now
      }
    }

    func ride(seconds: Int, trainer: UUID, strap: UUID?, from second: Int = 0) {
      for quarter in (second * 4)..<((second + seconds) * 4) {
        now += 0.25
        answerTrainerWrites(trainer)
        let watts = UInt16(150 + quarter % 37)
        let cadence = UInt16((80 + quarter % 9) * 2)
        transport.onCyclingMeasurement?(
          trainer, .indoorBike,
          Data([
            0x45, 0, UInt8(cadence & 0xFF), UInt8(cadence >> 8), UInt8(watts & 0xFF),
            UInt8(watts >> 8),
          ]))
        if let strap, quarter % 4 == 1 {
          transport.onHeartRateMeasurement?(
            strap, HeartRateMeasurement(beatsPerMinute: 120 + quarter % 11).data)
        }
        if quarter % 4 == 3 { tick(target: .power(watts: 150 + quarter % 3 * 10)) }
      }
    }

    func tick(target: TrainerTarget) {
      devices.recordTick(at: now)
      liveTicks.append(
        .init(
          power: devices.reading(for: .power, at: now),
          cadence: devices.reading(for: .cadence, at: now),
          heartRate: devices.reading(for: .heartRate, at: now)))
      devices.setTrainerTarget(target, at: now)
    }

    func answerTrainerWrites(_ trainer: UUID) {
      while answered < transport.trainerWrites.count {
        let opCode = transport.trainerWrites[answered].first ?? 0
        answered += 1
        transport.onTrainerValue?(trainer, .controlPoint, Data([0x80, opCode, 0x01]))
      }
    }
  }

  private func withDirectory(_ body: (URL) throws -> Void) throws {
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "BluetoothRecordingTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    try body(directory)
  }

  private func connectedBench() -> Bench {
    let bench = Bench()
    bench.transport.onAvailability?(.ready)
    bench.devices.pair(trainer)
    bench.devices.pair(strap)
    bench.transport.onConnect?(trainer.id)
    bench.transport.onConnect?(strap.id)
    bench.transport.onTrainerValue?(trainer.id, .powerRange, Data([0, 0, 0xD0, 0x07, 1, 0]))
    bench.transport.onTrainerControlReady?(trainer.id)
    bench.transport.onBatteryLevel?(strap.id, Data([64]))
    bench.ride(seconds: 3, trainer: trainer.id, strap: strap.id)
    bench.devices.setTrainerTarget(nil, at: bench.now)
    bench.answerTrainerWrites(trainer.id)
    bench.liveTicks = []
    return bench
  }

  private func log(in directory: URL) throws -> Data {
    try Data(contentsOf: directory.appending(path: BluetoothLog.fileName))
  }

  @Test func replaysARideToTheReadingsAndCommandsItHad() throws {
    try withDirectory { directory in
      let bench = connectedBench()
      bench.devices.startRecording(to: try #require(BluetoothLog(directory: directory)))
      let writesBefore = bench.transport.trainerWrites.count
      bench.devices.setTrainerTarget(.power(watts: 140), at: bench.now)
      bench.ride(seconds: 20, trainer: trainer.id, strap: strap.id)
      bench.transport.onDisconnect?(strap.id)
      bench.ride(seconds: 5, trainer: trainer.id, strap: nil, from: 20)
      bench.devices.stopRecording()

      let replay = BluetoothReplay(jsonLines: try log(in: directory))
      #expect(replay.ticks.count == 25)
      #expect(replay.ticks == bench.liveTicks)
      #expect(replay.ticks.last?.heartRate == nil)
      let writes = Array(bench.transport.trainerWrites.dropFirst(writesBefore))
      #expect(writes.count > 2)
      #expect(replay.recordedWrites == writes)
      #expect(replay.replayedWrites == writes)
    }
  }

  @Test func carriesOnRecordingARideResumedAfterACrash() throws {
    try withDirectory { directory in
      let first = connectedBench()
      first.devices.startRecording(to: try #require(BluetoothLog(directory: directory)))
      first.ride(seconds: 6, trainer: trainer.id, strap: strap.id)

      let second = connectedBench()
      second.now = first.now + 30
      second.devices.startRecording(
        to: try #require(BluetoothLog(directory: directory, resuming: true)))
      second.ride(seconds: 4, trainer: trainer.id, strap: strap.id)
      second.devices.stopRecording()

      let replay = BluetoothReplay(jsonLines: try log(in: directory))
      #expect(replay.ticks == first.liveTicks + second.liveTicks)
    }
  }

  @Test func keepsDeviceNamesAndIdentifiersOutOfTheLog() throws {
    try withDirectory { directory in
      let bench = connectedBench()
      bench.devices.startRecording(to: try #require(BluetoothLog(directory: directory)))
      bench.ride(seconds: 2, trainer: trainer.id, strap: strap.id)
      bench.devices.stopRecording()

      let text = String(decoding: try log(in: directory), as: UTF8.self)
      for secret in [trainer.id.uuidString, strap.id.uuidString, "KICKR", "Polar"] {
        #expect(!text.contains(secret))
      }
    }
  }

  @Test func rebuildsCrankCadenceFromBeforeTheRideStarted() throws {
    try withDirectory { directory in
      let bench = Bench()
      let crank = DiscoveredDevice(id: UUID(), services: [.speedAndCadence])
      bench.transport.onAvailability?(.ready)
      bench.devices.pair(crank)
      bench.transport.onConnect?(crank.id)
      @MainActor func turn(_ revolutions: UInt16) {
        let time = revolutions &* 1024
        bench.transport.onCyclingMeasurement?(
          crank.id, .speedAndCadence,
          Data([
            0x02, UInt8(revolutions & 0xFF), UInt8(revolutions >> 8), UInt8(time & 0xFF),
            UInt8(time >> 8),
          ]))
      }
      for revolutions in 0..<30 {
        bench.now += 1
        turn(UInt16(revolutions))
      }
      bench.devices.startRecording(to: try #require(BluetoothLog(directory: directory)))
      bench.now += 0.5
      turn(29)
      bench.tick(target: .power(watts: 150))
      bench.now += 1
      turn(30)
      bench.tick(target: .power(watts: 150))
      bench.devices.stopRecording()

      #expect(bench.liveTicks.map(\.cadence) == [60, 60])
      #expect(BluetoothReplay(jsonLines: try log(in: directory)).ticks == bench.liveTicks)
    }
  }

  @Test func replaysTheSourceTheRiderPicksDuringTheRide() throws {
    try withDirectory { directory in
      let bench = Bench()
      let meter = DiscoveredDevice(id: UUID(), services: [.power])
      bench.transport.onAvailability?(.ready)
      bench.devices.pair(trainer)
      bench.devices.pair(meter)
      bench.transport.onConnect?(trainer.id)
      bench.transport.onConnect?(meter.id)
      bench.devices.startRecording(to: try #require(BluetoothLog(directory: directory)))
      for second in 0..<4 {
        bench.now += 1
        bench.transport.onCyclingMeasurement?(
          trainer.id, .indoorBike, Data([0x45, 0, 0, 0, 200, 0]))
        bench.transport.onCyclingMeasurement?(meter.id, .power, Data([0, 0, 100, 0]))
        if second == 2 { bench.devices.select(meter, for: .power) }
        bench.tick(target: .power(watts: 150))
      }
      bench.devices.stopRecording()

      #expect(bench.liveTicks.map(\.power) == [200, 200, 100, 100])
      #expect(BluetoothReplay(jsonLines: try log(in: directory)).ticks == bench.liveTicks)
    }
  }
}
