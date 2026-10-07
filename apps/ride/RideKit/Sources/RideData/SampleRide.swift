import Foundation

extension RideRecording {
  /// A 30 minute indoor ride used by previews and tests, recorded against `Workout.sample`.
  public static func sample() throws -> RideRecording {
    try FITDecoder.decode(sampleFITData()).applying(.sample)
  }

  public static func sampleFITData() throws -> Data {
    guard let url = Bundle.module.url(forResource: "SampleRide", withExtension: "fit") else {
      throw FITError.noRecords
    }
    return try Data(contentsOf: url)
  }
}

extension Workout {
  /// Ten 3 minute steps ramping up and back down. The powers are read off a chart of the same
  /// ride, so they are good to about a watt.
  public static let sample = Workout(
    name: "Recovery 30",
    steps: [116, 127, 137, 147, 157, 157, 147, 137, 127, 116].map {
      Step(duration: 180, targetPower: $0)
    })
}
