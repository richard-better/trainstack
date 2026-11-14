import Foundation
import RideCore
import RideData
import Testing

@testable import RideBluetooth
@testable import RideUI

struct RideBluetoothLogTests {
  nonisolated static let traces = URL(filePath: #filePath).deletingLastPathComponent()
    .deletingLastPathComponent().appending(
      path: "RideCoreTests/Traces", directoryHint: .isDirectory)
  static let recordingFixture = ProcessInfo.processInfo.environment["RIDE_RECORD_TRACES"] == "1"
  static let fixtureName = "trainer-and-strap"
  nonisolated static let bluetoothSuffix = "." + BluetoothLog.fileName

  nonisolated static var bluetoothLogNames: [String] {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: traces.path)) ?? []
    return names.filter { $0.hasSuffix(bluetoothSuffix) }
      .map { String($0.dropLast(bluetoothSuffix.count)) }.sorted()
  }

  private let template = WorkoutTemplate.named("Quick test 45s")!
  private let trainer = DiscoveredDevice(id: UUID(), name: "KICKR CORE", services: [.trainer])
  private let strap = DiscoveredDevice(id: UUID(), name: "Polar H10", services: [.heartRate])

  private func withDirectory(_ body: (URL) throws -> Void) throws {
    let parent = FileManager.default.temporaryDirectory.appending(
      path: "RideBluetoothLogTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: parent) }
    try body(parent.appending(path: "Ride in progress", directoryHint: .isDirectory))
  }

  @Test func aRideRecordsBluetoothThatReplaysToTheReadingsItRode() throws {
    try withDirectory { directory in
      var now = Date(timeIntervalSinceReferenceDate: 815_000_000)
      let transport = CyclingTestTransport()
      let defaults = UserDefaults(suiteName: "RideBluetoothLogTests.\(UUID().uuidString)")!
      let devices = BluetoothDevices(transport: transport, defaults: defaults) { now }
      devices.pair(trainer)
      devices.pair(strap)
      transport.onConnect?(trainer.id)
      transport.onConnect?(strap.id)
      transport.onTrainerValue?(trainer.id, .powerRange, Data([0, 0, 0xD0, 0x07, 1, 0]))
      transport.onTrainerControlReady?(trainer.id)

      let session = RideSession(workout: template.workout(ftp: 250), startDate: now)
      let journal = try #require(
        RideJournal(
          directory: directory,
          header: .init(template: template, ftp: 250, startDate: now, riderWeight: 72)))
      devices.startRecording(to: try #require(BluetoothLog(directory: directory)))
      let controller = RideController(
        workout: template.planned, ftp: 250, devices: devices, session: session, journal: journal,
        simulated: false)
      var answered = 0
      for quarter in 1...(50 * 4) {
        now += 0.25
        while answered < transport.trainerWrites.count {
          let opCode = transport.trainerWrites[answered].first ?? 0
          answered += 1
          transport.onTrainerValue?(trainer.id, .controlPoint, Data([0x80, opCode, 0x01]))
        }
        let watts = UInt16(quarter / 40 == 2 ? 0 : 200 + quarter % 23)
        let cadence = UInt16((85 + quarter % 7) * 2)
        if !(120..<140).contains(quarter) {
          transport.onCyclingMeasurement?(
            trainer.id, .indoorBike,
            Data([
              0x45, 0, UInt8(cadence & 0xFF), UInt8(cadence >> 8), UInt8(watts & 0xFF),
              UInt8(watts >> 8),
            ]))
        }
        if quarter % 4 == 2 {
          transport.onHeartRateMeasurement?(
            strap.id, HeartRateMeasurement(beatsPerMinute: 130 + quarter % 13).data)
        }
        if quarter % 4 == 0 { controller.tick(seconds: 1, at: now) }
      }
      devices.stopRecording()
      journal.finish(keepingFor: "ride")

      let kept = RideJournal.traces(ofRide: "ride", besideJournalIn: directory)
      #expect(kept.map(\.lastPathComponent).contains { $0.hasSuffix(".\(BluetoothLog.fileName)") })
      let traceFile = try #require(kept.first { !$0.lastPathComponent.contains(".bluetooth.") })
      let logFile = try #require(kept.first { $0.lastPathComponent.contains(".bluetooth.") })
      let trace = try #require(RideTrace(jsonLines: Data(contentsOf: traceFile)))
      let replay = BluetoothReplay(jsonLines: try Data(contentsOf: logFile))
      let recorded = trace.inputs.compactMap { input -> TrainerReading? in
        guard case .tick(_, let reading, _) = input else { return nil }
        return reading
      }
      #expect(recorded.count == 50)
      #expect(replay.ticks.map(\.power) == recorded.map(\.power))
      #expect(replay.ticks.map(\.cadence) == recorded.map(\.cadence))
      #expect(replay.recordedWrites.count > 3)
      #expect(replay.replayedWrites == replay.recordedWrites)

      if Self.recordingFixture {
        try Data(contentsOf: traceFile).write(
          to: Self.traces.appending(path: "\(Self.fixtureName).jsonl"))
        try Data(contentsOf: logFile).write(
          to: Self.traces.appending(path: "\(Self.fixtureName).\(BluetoothLog.fileName)"))
      }
    }
  }

  @Test(arguments: bluetoothLogNames)
  func replaysEachBluetoothLogToTheReadingsItsRideRecorded(_ name: String) throws {
    let trace = try #require(
      RideTrace(jsonLines: Data(contentsOf: Self.traces.appending(path: "\(name).jsonl"))))
    let replay = BluetoothReplay(
      jsonLines: try Data(
        contentsOf: Self.traces.appending(path: "\(name)\(Self.bluetoothSuffix)")))
    let recorded = trace.inputs.compactMap { input -> TrainerReading? in
      guard case .tick(_, let reading, _) = input else { return nil }
      return reading
    }
    #expect(replay.ticks.map(\.power) == recorded.map(\.power))
    #expect(replay.ticks.map(\.cadence) == recorded.map(\.cadence))
    #expect(replay.replayedWrites == replay.recordedWrites)
  }

  @Test func theTraceFixturesIncludeABluetoothLog() {
    #expect(Self.bluetoothLogNames.contains(Self.fixtureName))
  }
}
