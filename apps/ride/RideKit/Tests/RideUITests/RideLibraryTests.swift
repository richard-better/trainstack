import Foundation
import RideData
import Testing

@testable import RideUI

struct RideLibraryTests {
  /// An empty folder for one test, removed when `body` returns.
  private func withDirectory(_ body: (URL) throws -> Void) throws {
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "RideLibraryTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    try body(directory)
  }

  private func fileNames(in directory: URL) throws -> [String] {
    try FileManager.default.contentsOfDirectory(atPath: directory.path).sorted()
  }

  /// A ride of the quick test workout that started at `startDate`, as the controller records it.
  private func quickTest(startDate: Date = .now) throws -> RideRecording {
    let template = try #require(WorkoutTemplate.named("Quick test 45s"))
    var session = RideSession(workout: template.workout(ftp: 200), startDate: startDate)
    for _ in 0..<45 {
      session.advance(by: 1, reading: .init(power: 150, cadence: 90, heartRate: 130))
    }
    return session.recording()
  }

  @Test func keepsASavedRideBetweenLaunches() throws {
    try withDirectory { directory in
      let ride = try quickTest()
      let library = RideLibrary(directory: directory)
      library.save(ride)
      #expect(library.storageProblem == nil)

      let reopened = RideLibrary(directory: directory)
      let saved = try #require(reopened.rides.first)
      #expect(reopened.rides.count == 1)
      #expect(saved.title == "Quick test 45s")
      #expect(saved.recording.sport == .cycling)
      #expect(saved.recording.samples.count == 45)
      #expect(saved.recording.hasTarget)
      #expect(saved.recording.samples.map(\.targetPower).prefix(15).allSatisfy { $0 == 100 })
      #expect(saved.recording.samples.map(\.targetPower).suffix(15).allSatisfy { $0 == 240 })
    }
  }

  @Test func namesTheFileForWhenTheRideStarted() throws {
    try withDirectory { directory in
      let start = Date(timeIntervalSince1970: 1_791_296_475)  // 2026-10-06 14:21:15 UTC
      RideLibrary(directory: directory).save(try quickTest(startDate: start))
      #expect(try fileNames(in: directory) == ["20261006T142115Z.fit"])
    }
  }

  @Test func keepsTwoRidesThatStartedTheSameSecond() throws {
    try withDirectory { directory in
      let start = Date(timeIntervalSince1970: 1_791_296_475)
      var other = try quickTest(startDate: start)
      other.samples.removeLast()
      let library = RideLibrary(directory: directory)
      library.save(try quickTest(startDate: start))
      library.save(other)
      #expect(try fileNames(in: directory).count == 2)
      #expect(RideLibrary(directory: directory).rides.count == 2)
    }
  }

  @Test func givesARideTheSameIDOnEveryLaunch() throws {
    try withDirectory { directory in
      let library = RideLibrary(directory: directory)
      library.save(try quickTest())
      let id = try #require(library.rides.first?.id)
      #expect(RideLibrary(directory: directory).rides.map(\.id) == [id])
    }
  }

  @Test func doesNotSaveTheSameRideTwice() throws {
    try withDirectory { directory in
      let ride = try quickTest()
      let library = RideLibrary(directory: directory)
      library.save(ride)
      library.save(ride)
      #expect(library.rides.count == 1)
      #expect(try fileNames(in: directory).count == 1)
    }
  }

  @Test func removingARideDeletesItsFile() throws {
    try withDirectory { directory in
      let library = RideLibrary(directory: directory)
      library.save(try quickTest())
      library.remove(try #require(library.rides.first).id)
      #expect(try fileNames(in: directory).isEmpty)
      #expect(RideLibrary(directory: directory).rides.isEmpty)
    }
  }

  @Test func skipsFilesThatAreNotRides() throws {
    try withDirectory { directory in
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try Data("not a ride".utf8).write(to: directory.appending(path: "broken.fit"))
      try Data("notes".utf8).write(to: directory.appending(path: "notes.txt"))
      let library = RideLibrary(directory: directory)
      library.save(try quickTest())
      #expect(RideLibrary(directory: directory).rides.count == 1)
    }
  }

  @Test func keepsTheRideAndSaysSoWhenItCannotBeWritten() throws {
    try withDirectory { directory in
      // A file where the folder should be.
      try Data().write(to: directory)
      let library = RideLibrary(directory: directory)
      library.save(try quickTest())
      #expect(library.rides.count == 1)
      #expect(library.storageProblem?.contains("Quick test 45s") == true)
    }
  }

  @Test func newestRideComesFirst() throws {
    try withDirectory { directory in
      let library = RideLibrary(directory: directory)
      library.save(try quickTest(startDate: Date(timeIntervalSince1970: 1_791_000_000)))
      library.save(try quickTest(startDate: Date(timeIntervalSince1970: 1_792_000_000)))
      let reopened = RideLibrary(directory: directory)
      #expect(
        reopened.rides.map(\.recording.startDate) == [
          Date(timeIntervalSince1970: 1_792_000_000), Date(timeIntervalSince1970: 1_791_000_000),
        ])
    }
  }
}
