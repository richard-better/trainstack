import RideData
import RideStrava

extension Ride {
  private static let longestActivityName = 200

  var activityFile: ActivityFile {
    let recordedByRide = FITDecoder.isRecordedByRide(fileData)
    let name = recording.workoutName?.trimmingCharacters(in: .whitespacesAndNewlines)
    return ActivityFile(
      data: fileData, fileName: exportFileName,
      source: recordedByRide ? "trainstack" : "upload",
      sport: recordedByRide ? "indoor_cycling" : recording.sport?.rawValue,
      name: name.flatMap { $0.isEmpty ? nil : String($0.prefix(Self.longestActivityName)) },
      startedAt: recording.startDate)
  }
}
