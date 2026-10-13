import Foundation
import Testing

@testable import RideData

struct FITEncoderTests {
  private let start = Date(timeIntervalSince1970: 1_791_296_475)

  private func recording(
    sport: Sport? = .cycling, workoutName: String? = "Quick test 45s"
  ) -> RideRecording {
    let samples = (1...45).map { second in
      RideRecording.Sample(
        elapsed: TimeInterval(second), power: 100 + second, targetPower: second <= 15 ? 100 : 150,
        heartRate: 90 + second / 5, cadence: 85, speed: 8.25, distance: 8.25 * Double(second))
    }
    return RideRecording(
      startDate: start, workoutName: workoutName, sport: sport, samples: samples,
      summary: .init(
        duration: 45, distance: 371.25, averagePower: 123, maxPower: 145, averageHeartRate: 94,
        maxHeartRate: 99))
  }

  @Test func decodesBackToTheSameRide() throws {
    let original = recording()
    let decoded = try FITDecoder.decode(FITEncoder.encode(original))
    #expect(decoded == original)
  }

  @Test func keepsTheTargetPowerOfEachSample() throws {
    let decoded = try FITDecoder.decode(FITEncoder.encode(recording()))
    #expect(decoded.hasTarget)
    #expect(decoded.samples.map(\.targetPower) == recording().samples.map(\.targetPower))
  }

  @Test func leavesOutWhatWasNotMeasured() throws {
    var ride = recording(sport: nil, workoutName: nil)
    ride.samples = ride.samples.map {
      RideRecording.Sample(elapsed: $0.elapsed, power: $0.power)
    }
    ride.summary = .init(duration: 45, averagePower: 123, maxPower: 145)
    let decoded = try FITDecoder.decode(FITEncoder.encode(ride))
    #expect(decoded == ride)
    #expect(!decoded.hasHeartRate && !decoded.hasSpeed && !decoded.hasTarget)
  }

  @Test func readsAsAValidFITFile() {
    let bytes = [UInt8](FITEncoder.encode(recording()))
    #expect(bytes[0] == 14)
    #expect(Array(bytes[8..<12]) == Array(".FIT".utf8))
    let dataSize = Int(bytes[4]) | Int(bytes[5]) << 8 | Int(bytes[6]) << 16 | Int(bytes[7]) << 24
    #expect(bytes.count == 14 + dataSize + 2)
    // A checksum over a block and its own checksum comes to zero.
    #expect(fitChecksum(bytes[0..<14]) == 0)
    #expect(fitChecksum(bytes[...]) == 0)
  }

  @Test func savesTheSport() throws {
    #expect(try FITDecoder.decode(FITEncoder.encode(recording())).sport == .cycling)
    #expect(try FITDecoder.decode(FITEncoder.encode(recording(sport: nil))).sport == nil)
  }

  @Test func savesCyclingAsAVirtualRide() {
    #expect(Sport.cycling.fitSport.sport == 2)
    #expect(Sport.cycling.fitSport.subSport == 58)
  }

  @Test func dropsASampleThatSharesASecondWithTheLast() throws {
    var ride = recording()
    ride.samples.insert(
      RideRecording.Sample(elapsed: 10.4, power: 999), at: 10)
    let decoded = try FITDecoder.decode(FITEncoder.encode(ride))
    #expect(decoded.samples.count == 45)
    #expect(decoded.samples.allSatisfy { $0.power != 999 })
  }

  @Test func keepsALongWorkoutNameWhole() throws {
    let name = String(repeating: "é", count: 40)
    let decoded = try FITDecoder.decode(FITEncoder.encode(recording(workoutName: name)))
    #expect(decoded.workoutName == name)
  }

  @Test func recordsASessionAsItWasRidden() throws {
    var session = RideSession(
      workout: .init(name: "Pair", steps: [.init(duration: 3, targetPower: 150)]), startDate: start)
    for second in 1...3 {
      session.advance(
        by: 1, reading: .init(power: 140 + second, cadence: 90, heartRate: 120))
    }
    let decoded = try FITDecoder.decode(FITEncoder.encode(session.recording()))
    #expect(decoded.workoutName == "Pair")
    #expect(decoded.sport == .cycling)
    #expect(decoded.samples.map(\.power) == [141, 142, 143])
    #expect(decoded.samples.map(\.targetPower) == [150, 150, 150])
    #expect(decoded.summary.duration == 3)
    // Speed and distance come from power, since the trainer reports none.
    #expect(abs((decoded.samples.last?.speed ?? 0) - session.speed) < 0.001)
    #expect(abs((decoded.summary.distance ?? 0) - session.distance) < 0.01)
    #expect(session.distance > 0)
  }
}
