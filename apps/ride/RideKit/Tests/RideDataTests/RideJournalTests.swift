import Foundation
import Testing

@testable import RideData

struct RideJournalTests {
  private let start = Date(timeIntervalSince1970: 1_791_296_475)
  private let template = WorkoutTemplate(
    name: "Journal 30", category: .threshold,
    steps: [.init(duration: 10, intensity: 0.5), .init(duration: 20, intensity: 1)])

  private func withDirectory(_ body: (URL) throws -> Void) throws {
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "RideJournalTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    try body(directory)
  }

  private func journal(in directory: URL) throws -> RideJournal {
    try #require(
      RideJournal(
        directory: directory, header: .init(template: template, ftp: 200, startDate: start)))
  }

  /// Rides `seconds` into a journal, as the controller does, returning the session.
  @discardableResult
  private func ride(
    _ seconds: Int, journaling journal: RideJournal, from session: RideSession? = nil
  ) -> RideSession {
    var session = session ?? RideSession(workout: template.workout(ftp: 200), startDate: start)
    for _ in 0..<seconds {
      let before = session.samples.count
      session.advance(by: 1, reading: .init(power: 140, cadence: 90))
      journal.append(
        .init(
          state: session.state, sample: session.samples.count > before ? session.samples.last : nil)
      )
    }
    return session
  }

  @Test func recoversTheRideAsFarAsItGot() throws {
    try withDirectory { directory in
      let session = ride(12, journaling: try journal(in: directory))
      let interrupted = try #require(RideJournal.recover(from: directory))
      #expect(interrupted.name == "Journal 30")
      #expect(interrupted.header.ftp == 200)
      #expect(interrupted.samples.count == 12)
      #expect(interrupted.state == session.state)
      #expect(interrupted.session().recording() == session.recording())
    }
  }

  @Test func recoversTheTemplateItWasRiddenWith() throws {
    try withDirectory { directory in
      ride(3, journaling: try journal(in: directory))
      #expect(try #require(RideJournal.recover(from: directory)).header.template == template)
    }
  }

  @Test func comesBackPausedAtTheMomentItStopped() throws {
    try withDirectory { directory in
      let journal = try journal(in: directory)
      var session = ride(5, journaling: journal)
      session.adjust(by: 7)
      session.skipInterval()
      journal.append(.init(state: session.state, sample: nil))
      let resumed = try #require(RideJournal.recover(from: directory)).session()
      #expect(resumed.isPaused)
      #expect(resumed.ergPercent == 107)
      #expect(resumed.position == 10)
      #expect(resumed.elapsed == 5)
      #expect(resumed.samples.count == 5)
    }
  }

  @Test func carriesOnRecordingFromWhereItLeftOff() throws {
    try withDirectory { directory in
      ride(5, journaling: try journal(in: directory))
      var resumed = try #require(RideJournal.recover(from: directory)).session()
      resumed.togglePause()
      resumed.advance(by: 1, reading: .init(power: 150))
      #expect(resumed.samples.count == 6)
      #expect(resumed.samples.last?.sample.elapsed == 6)
    }
  }

  @Test func carriesOnAfterARecovery() throws {
    try withDirectory { directory in
      ride(5, journaling: try journal(in: directory))
      let handle = try FileHandle(forWritingTo: directory.appending(path: "ride.jsonl"))
      try handle.seekToEnd()
      try handle.write(contentsOf: Data(#"{"state":{"elapsed":6"#.utf8))
      try handle.close()

      let interrupted = try #require(RideJournal.recover(from: directory))
      let resumed = try #require(RideJournal(resuming: directory))
      var session = interrupted.session()
      session.togglePause()
      ride(3, journaling: resumed, from: session)

      let again = try #require(RideJournal.recover(from: directory))
      #expect(again.samples.count == 8)
      #expect(again.state.elapsed == 8)
      #expect(again.header.startDate == start)
    }
  }

  @Test func cannotCarryOnWithoutAJournal() throws {
    try withDirectory { directory in
      #expect(RideJournal(resuming: directory) == nil)
    }
  }

  @Test func skipsALineCutOffByTheCrash() throws {
    try withDirectory { directory in
      let session = ride(8, journaling: try journal(in: directory))
      let url = directory.appending(path: "ride.jsonl")
      let handle = try FileHandle(forWritingTo: url)
      try handle.seekToEnd()
      try handle.write(contentsOf: Data(#"{"state":{"elapsed":9,"posi"#.utf8))
      try handle.close()
      let interrupted = try #require(RideJournal.recover(from: directory))
      #expect(interrupted.samples.count == 8)
      #expect(interrupted.state == session.state)
    }
  }

  @Test func hasNothingToRecoverBeforeTheFirstSample() throws {
    try withDirectory { directory in
      ride(0, journaling: try journal(in: directory))
      #expect(RideJournal.recover(from: directory) == nil)
      #expect(RideJournal.recover(from: directory.appending(path: "missing")) == nil)
    }
  }

  @Test func finishingDeletesTheJournal() throws {
    try withDirectory { directory in
      let journal = try journal(in: directory)
      ride(4, journaling: journal)
      journal.finish()
      #expect(RideJournal.recover(from: directory) == nil)
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
      #expect(try #require(RideJournal.recover(from: directory)).samples.count == 2)
    }
  }
}
