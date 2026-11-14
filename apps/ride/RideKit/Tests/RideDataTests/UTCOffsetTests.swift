import Foundation
import Testing

@testable import RideData

struct UTCOffsetTests {
  private func recording(utcOffsetSeconds: Int?) -> RideRecording {
    var session = RideSession(
      workout: WorkoutTemplate.named("Quick test 45s")!.workout(ftp: 200),
      startDate: Date(timeIntervalSince1970: 1_800_000_000), utcOffsetSeconds: utcOffsetSeconds)
    for _ in 0..<45 { session.advance(by: 1, reading: .init(power: 150)) }
    return session.recording()
  }

  static let offsets: [Int] = [0, 3_600, -18_000, 20_700, 50_400, -43_200]

  @Test(arguments: offsets)
  func theFileCarriesTheLocalTimeTheRideStartedIn(_ offset: Int) throws {
    let decoded = try FITDecoder.decode(FITEncoder.encode(recording(utcOffsetSeconds: offset)))
    #expect(decoded.utcOffsetSeconds == offset)
  }

  @Test func aRideWithNoKnownTimeZoneWritesNoLocalTime() throws {
    let decoded = try FITDecoder.decode(FITEncoder.encode(recording(utcOffsetSeconds: nil)))
    #expect(decoded.utcOffsetSeconds == nil)
  }

  @Test func anOffsetNoPlaceOnEarthHasIsLeftOut() throws {
    let decoded = try FITDecoder.decode(
      FITEncoder.encode(recording(utcOffsetSeconds: 15 * 3600)))
    #expect(decoded.utcOffsetSeconds == nil)
  }

  @Test func aRideFileFromBeforeLocalTimeStillDecodesWithoutIt() throws {
    let file = URL(filePath: #filePath).deletingLastPathComponent()
      .appending(path: "Fixtures/ride-before-laps.fit")
    let decoded = try FITDecoder.decode(Data(contentsOf: file))
    #expect(decoded.utcOffsetSeconds == nil)
    #expect(decoded.samples.count == 550)
  }
}
