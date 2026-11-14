import Foundation
import RideData
import Testing

@testable import RideCore

struct RideTraceReplayTests {
  static let traces = URL(filePath: #filePath).deletingLastPathComponent().appending(
    path: "Traces", directoryHint: .isDirectory)

  static let recordingGoldens = ProcessInfo.processInfo.environment["RIDE_RECORD_TRACES"] == "1"

  static let scenarios: [String: HeadlessRide] = [
    "extended-repeated-and-ridden-on": HeadlessRide(
      WorkoutTemplate.named("Recovery 30")!.fitted(to: 300), ftp: 220,
      utcOffsetSeconds: 2 * 60 * 60,
      events: [
        20: [.rider(.extendInterval(seconds: 60))], 70: [.rider(.markLap)],
        130: [.rider(.previousInterval)], 140: [.rider(.changeMode(.slope))],
        160: [.rider(.changeMode(.erg))], 200: [.rider(.skipInterval)],
        260: [.rider(.extendInterval(seconds: 30))],
      ], ridingOnFor: 90),
    "laps-marked-paused-and-skipped": HeadlessRide(
      WorkoutTemplate.named("Recovery 30")!.fitted(to: 300), ftp: 220,
      utcOffsetSeconds: -5 * 60 * 60,
      events: [
        50: [.rider(.markLap)], 51: [.rider(.markLap)], 90: [.rider(.togglePause)],
        110: [.rider(.markLap)], 120: [.rider(.togglePause)], 160: [.rider(.skipInterval)],
        200: [.rider(.markLap)],
      ]),
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

  static var traceNames: [String] {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: traces.path)) ?? []
    return names.filter { $0.hasSuffix(".jsonl") }.map { String($0.dropLast(".jsonl".count)) }
      .filter { !$0.contains(".") }.sorted()
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
}
