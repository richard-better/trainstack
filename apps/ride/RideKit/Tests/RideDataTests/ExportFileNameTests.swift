import Foundation
import Testing

@testable import RideData

struct ExportFileNameTests {
  @Test func keepsOrdinaryWorkoutNames() throws {
    var ride = try RideRecording.sample()
    ride.workoutName = "Threshold builder"
    #expect(ride.exportFileName == "Threshold builder 2026-10-06.fit")
  }

  @Test func neverEscapesItsDirectory() throws {
    var ride = try RideRecording.sample()
    for name in ["../../etc/passwd", "..\\..\\x", "a/b:c", "/", "..", "\u{0}\n"] {
      ride.workoutName = name
      let fileName = ride.exportFileName
      #expect(!fileName.contains("/") && !fileName.contains("\\") && !fileName.hasPrefix("."))
      #expect(
        URL(filePath: "/tmp/ride").appending(path: fileName).deletingLastPathComponent().path
          == "/tmp/ride")
    }
  }
}
