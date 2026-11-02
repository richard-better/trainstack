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
        heartRate: 90 + second / 5, cadence: 85, speedMetresPerSecond: 8.25,
        distanceMetres: 8.25 * Double(second))
    }
    return RideRecording(
      startDate: start, workoutName: workoutName, sport: sport, samples: samples,
      summary: .init(
        duration: 45, distanceMetres: 371.25, averagePower: 123, maxPower: 145,
        averageHeartRate: 94,
        maxHeartRate: 99))
  }

  @Test func decodesBackToTheSameRide() throws {
    let original = recording()
    let decoded = try FITDecoder.decode(FITEncoder.encode(original))
    #expect(decoded == original)
  }

  @Test func marksTheFileAsRecordedByRide() {
    #expect(FITDecoder.isRecordedByRide(FITEncoder.encode(recording())))
  }

  @Test func namesItsApplicationInTheSixteenBytesFITAllows() {
    #expect(FITEncoder.applicationID.count == 16)
  }

  @Test func tellsAnotherAppsFileFromRides() throws {
    var bytes = [UInt8](FITEncoder.encode(recording()))
    let id = Array("trainstack-ride!".utf8)
    let other = Array("another-app-1234".utf8)
    var index = 0
    while index + id.count <= bytes.count {
      if Array(bytes[index..<index + id.count]) == id {
        bytes.replaceSubrange(index..<index + id.count, with: other)
      }
      index += 1
    }
    let end = bytes.count - 2
    let checksum = fitChecksum(bytes[0..<end])
    bytes[end] = UInt8(checksum & 0xFF)
    bytes[end + 1] = UInt8(checksum >> 8)
    let file = Data(bytes)
    #expect(try FITDecoder.decode(file).samples.count == 45)
    #expect(!FITDecoder.isRecordedByRide(file))
    #expect(!FITDecoder.isRecordedByRide(Data("not a FIT file".utf8)))
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
  }

  @Test func checksumsTheHeaderAndTheFileSoEachComesToZeroWithItsChecksum() {
    let bytes = [UInt8](FITEncoder.encode(recording()))
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

  @Test func cutsANameTooLongForAStringFieldBetweenCharacters() throws {
    let name = String(repeating: "é", count: 200)
    let decoded = try FITDecoder.decode(FITEncoder.encode(recording(workoutName: name)))
    #expect(decoded.workoutName == String(repeating: "é", count: 127))
  }

  private func riddenSession() -> RideSession {
    var session = RideSession(
      workout: .init(name: "Pair", steps: [.init(duration: 3, targetPower: 150)]), startDate: start)
    for second in 1...3 {
      session.advance(
        by: 1, reading: .init(power: 140 + second, cadence: 90, heartRate: 120))
    }
    return session
  }

  @Test func recordsASessionAsItWasRidden() throws {
    let session = riddenSession()
    let decoded = try FITDecoder.decode(FITEncoder.encode(session.recording()))
    #expect(decoded.workoutName == "Pair")
    #expect(decoded.sport == .cycling)
    #expect(decoded.samples.map(\.power) == [141, 142, 143])
    #expect(decoded.samples.map(\.targetPower) == [150, 150, 150])
    #expect(decoded.summary.duration == 3)
  }

  @Test func recordsTheSpeedAndDistanceWorkedOutFromPowerAlone() throws {
    let session = riddenSession()
    let decoded = try FITDecoder.decode(FITEncoder.encode(session.recording()))
    let speed = decoded.samples.last?.speedMetresPerSecond ?? 0
    #expect(abs(speed - session.speedMetresPerSecond) < 0.001)
    #expect(abs((decoded.summary.distanceMetres ?? 0) - session.distanceMetres) < 0.01)
    #expect(session.distanceMetres > 0)
  }
}
