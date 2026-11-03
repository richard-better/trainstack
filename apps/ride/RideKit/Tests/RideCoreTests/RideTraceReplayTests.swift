import Foundation
import RideData
import Testing

@testable import RideBluetooth
@testable import RideCore

struct RideTraceReplayTests {
  static let traces = URL(filePath: #filePath).deletingLastPathComponent().appending(
    path: "Traces", directoryHint: .isDirectory)

  static let recordingGoldens = ProcessInfo.processInfo.environment["RIDE_RECORD_TRACES"] == "1"

  static let scenarios: [String: HeadlessRide] = [
    "quick-test-trainer-drop": HeadlessRide(
      .named("Quick test 45s")!, ftp: 250, events: [20: [.trainerDrops(forSeconds: 8)]]),
    "recovery-every-control": HeadlessRide(
      WorkoutTemplate.named("Recovery 30")!.fitted(to: 600), ftp: 210,
      events: [
        60: [.rider(.changeMode(.slope))], 120: [.rider(.adjust(steps: 3))],
        200: [.rider(.togglePause)], 230: [.rider(.togglePause)],
        300: [.rider(.changeMode(.level))], 330: [.rider(.adjust(steps: -2))],
        360: [.rider(.changeMode(.erg))], 400: [.rider(.skipInterval)],
        450: [.trainerDrops(forSeconds: 15)],
      ]),
  ]

  static let bluetoothSuffix = "." + BluetoothLog.fileName

  static var traceNames: [String] {
    names(endingWith: ".jsonl").filter { !$0.hasSuffix(bluetoothSuffix.dropLast(".jsonl".count)) }
  }

  static var bluetoothLogNames: [String] { names(endingWith: bluetoothSuffix) }

  private static func names(endingWith suffix: String) -> [String] {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: traces.path)) ?? []
    return names.filter { $0.hasSuffix(suffix) }.map { String($0.dropLast(suffix.count)) }.sorted()
  }

  @Test(.enabled(if: recordingGoldens))
  func recordsTheScenarioTraces() throws {
    try FileManager.default.createDirectory(at: Self.traces, withIntermediateDirectories: true)
    for (name, ride) in Self.scenarios {
      let outcome = ride.run(with: SimulatedRider(.typical(ftp: ride.header.ftp)))
      try outcome.trace.jsonLines().write(to: Self.traces.appending(path: "\(name).jsonl"))
    }
  }

  @Test func everyScenarioHasATrace() {
    #expect(Set(Self.scenarios.keys).isSubset(of: Self.traceNames))
  }

  @Test(arguments: traceNames)
  func replaysEachTraceToTheRideItRecorded(_ name: String) throws {
    let data = try Data(contentsOf: Self.traces.appending(path: "\(name).jsonl"))
    let trace = try #require(RideTrace(jsonLines: data))
    let fit = FITEncoder.encode(trace.replay().session.recording())
    let golden = Self.traces.appending(path: "\(name).fit")
    if Self.recordingGoldens { try fit.write(to: golden) }
    #expect(fit == (try Data(contentsOf: golden)))
  }

  @MainActor
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
}
