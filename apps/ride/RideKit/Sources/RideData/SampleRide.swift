import Foundation

extension RideRecording {
  /// A 30 minute indoor ride used by previews and tests.
  public static func sample() throws -> RideRecording {
    try FITDecoder.decode(sampleFITData())
  }

  public static func sampleFITData() throws -> Data {
    guard let url = Bundle.module.url(forResource: "SampleRide", withExtension: "fit") else {
      throw FITError.noRecords
    }
    return try Data(contentsOf: url)
  }
}
