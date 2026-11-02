import Foundation
import RideData
import Testing

@testable import RideCore

struct RideJournalTests {
  private let start = Date(timeIntervalSince1970: 1_791_296_475)
  private let template = WorkoutTemplate(
    name: "Journal 30", category: .threshold,
    steps: [.init(duration: 10, intensity: 0.5), .init(duration: 20, intensity: 1)])

  private func withDirectory(_ body: (URL) throws -> Void) throws {
    let parent = FileManager.default.temporaryDirectory.appending(
      path: "RideJournalTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: parent) }
    try body(parent.appending(path: "Ride in progress", directoryHint: .isDirectory))
  }

  private var header: RideTrace.Header {
    .init(template: template, ftp: 200, startDate: start, riderWeight: 72)
  }

  private func journal(in directory: URL) throws -> RideJournal {
    try #require(RideJournal(directory: directory, header: header))
  }

  @discardableResult
  private func ride(
    _ seconds: Int, journaling journal: RideJournal, from engine: RideEngine? = nil
  ) -> RideEngine {
    var engine =
      engine ?? RideEngine(session: RideTrace(header: header).freshSession())
    if engine.session.samples.isEmpty {
      apply(.begin(trainerConnected: true), to: &engine, journal)
    }
    for _ in 0..<seconds {
      apply(
        .tick(seconds: 1, reading: .init(power: 140, cadence: 90), trainerConnected: true),
        to: &engine, journal)
    }
    return engine
  }

  private func apply(_ input: RideInput, to engine: inout RideEngine, _ journal: RideJournal) {
    journal.append(input)
    engine.apply(input)
  }

  private func append(_ text: String, toJournalIn directory: URL) throws {
    let handle = try FileHandle(forWritingTo: directory.appending(path: "ride.jsonl"))
    try handle.seekToEnd()
    try handle.write(contentsOf: Data(text.utf8))
    try handle.close()
  }

  @Test func recoversTheRideExactlyAsItWasRidden() throws {
    try withDirectory { directory in
      let engine = ride(12, journaling: try journal(in: directory))
      let interrupted = try #require(RideJournal.recover(from: directory))
      #expect(interrupted.name == "Journal 30")
      #expect(interrupted.trace.header == header)
      #expect(interrupted.session.samples == engine.session.samples)
      #expect(interrupted.session.recording() == engine.session.recording())
      #expect(interrupted.session.speedMetresPerSecond == engine.session.speedMetresPerSecond)
    }
  }

  @Test func recoversWhatTheRiderChangedAlongTheWay() throws {
    try withDirectory { directory in
      let journal = try journal(in: directory)
      var engine = ride(5, journaling: journal)
      apply(.adjust(steps: 7), to: &engine, journal)
      apply(.skipInterval, to: &engine, journal)
      apply(.togglePause, to: &engine, journal)
      let recovered = try #require(RideJournal.recover(from: directory)).session
      #expect(recovered.isPaused)
      #expect(recovered.ergPercent == 107)
      #expect(recovered.position == 10)
      #expect(recovered.elapsed == 5)
      #expect(recovered.samples.count == 5)
    }
  }

  @Test func aResumedRideComesBackPausedAndCarriesOnRecording() throws {
    try withDirectory { directory in
      ride(5, journaling: try journal(in: directory))
      var engine = try #require(RideJournal.recover(from: directory)).engine
      let resumed = try #require(RideJournal(resuming: directory))
      apply(.resumeAfterCrash(trainerConnected: true), to: &engine, resumed)
      #expect(engine.session.isPaused)
      apply(.togglePause, to: &engine, resumed)
      ride(3, journaling: resumed, from: engine)

      let again = try #require(RideJournal.recover(from: directory)).session
      #expect(again.samples.count == 8)
      #expect(again.samples.last?.sample.elapsed == 8)
      #expect(again.startDate == start)
    }
  }

  @Test func carriesOnAfterALineCutOffByTheCrash() throws {
    try withDirectory { directory in
      ride(5, journaling: try journal(in: directory))
      try append(#"{"tick":{"seconds":1,"rea"#, toJournalIn: directory)
      var engine = try #require(RideJournal.recover(from: directory)).engine
      let resumed = try #require(RideJournal(resuming: directory))
      apply(.resumeAfterCrash(trainerConnected: true), to: &engine, resumed)
      apply(.togglePause, to: &engine, resumed)
      ride(2, journaling: resumed, from: engine)
      #expect(try #require(RideJournal.recover(from: directory)).session.samples.count == 7)
    }
  }

  @Test func cannotStartAJournalWhereItsDirectoryCannotBeMade() throws {
    try withDirectory { directory in
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      let file = directory.appending(path: "file")
      FileManager.default.createFile(atPath: file.path, contents: Data())
      #expect(RideJournal(directory: file.appending(path: "journal"), header: header) == nil)
    }
  }

  @Test func cannotCarryOnWithoutAJournal() throws {
    try withDirectory { directory in
      #expect(RideJournal(resuming: directory) == nil)
    }
  }

  @Test func hasNothingToRecoverBeforeTheFirstSample() throws {
    try withDirectory { directory in
      ride(0, journaling: try journal(in: directory))
      #expect(RideJournal.recover(from: directory) == nil)
      #expect(RideJournal.recover(from: directory.appending(path: "missing")) == nil)
    }
  }

  @Test func finishingKeepsTheJournalAsATraceThatReplaysTheRide() throws {
    try withDirectory { directory in
      let journal = try journal(in: directory)
      let engine = ride(4, journaling: journal)
      journal.finish()
      #expect(RideJournal.recover(from: directory) == nil)
      let traces = RideJournal.tracesDirectory(besideJournalIn: directory)
      let names = try FileManager.default.contentsOfDirectory(atPath: traces.path)
      #expect(names.count == 1)
      let data = try Data(contentsOf: traces.appending(path: try #require(names.first)))
      let trace = try #require(RideTrace(jsonLines: data))
      #expect(trace.replay().session.recording() == engine.session.recording())
    }
  }

  @Test func keepsOnlyTheLatestTraces() throws {
    try withDirectory { directory in
      for ride in 0..<(RideJournal.tracesKept + 2) {
        let header = RideTrace.Header(
          template: template, ftp: 200, startDate: start.addingTimeInterval(Double(ride) * 3600),
          riderWeight: 72)
        try #require(RideJournal(directory: directory, header: header)).finish()
      }
      let traces = RideJournal.tracesDirectory(besideJournalIn: directory)
      let names = try FileManager.default.contentsOfDirectory(atPath: traces.path).sorted()
      #expect(names.count == RideJournal.tracesKept)
      #expect(
        names.first == RideJournal.traceFileName(startingAt: start.addingTimeInterval(2 * 3600)))
    }
  }

  @Test func discardingDeletesTheJournal() throws {
    try withDirectory { directory in
      ride(4, journaling: try journal(in: directory))
      RideJournal.discard(in: directory)
      #expect(RideJournal.recover(from: directory) == nil)
    }
  }

  @Test func aNewRideReplacesTheLastJournal() throws {
    try withDirectory { directory in
      ride(6, journaling: try journal(in: directory))
      ride(2, journaling: try journal(in: directory))
      #expect(try #require(RideJournal.recover(from: directory)).session.samples.count == 2)
    }
  }
}
