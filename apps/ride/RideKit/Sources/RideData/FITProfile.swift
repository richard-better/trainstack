import Foundation

enum FITProfile {
  static let epochInUnixTime = 631_065_600
  static let version: UInt16 = 2140
  static let protocolVersion: UInt8 = 0x20
  static let headerSize: UInt8 = 14
  static let longestStringFieldBytes = 255

  enum MessageNumber {
    static let fileID = 0
    static let session = 18
    static let lap = 19
    static let record = 20
    static let event = 21
    static let workout = 26
    static let activity = 34
    static let fieldDescription = 206
    static let developerDataID = 207
  }

  enum BaseType {
    static let enumeration: UInt8 = 0x00
    static let uint8: UInt8 = 0x02
    static let string: UInt8 = 0x07
    static let byteArray: UInt8 = 0x0D
    static let uint16: UInt8 = 0x84
    static let uint32: UInt8 = 0x86
  }

  enum CommonField {
    static let timestamp = 253
    static let messageIndex = 254
  }

  enum FileIDField {
    static let type = 0
    static let manufacturer = 1
    static let product = 2
    static let timeCreated = 4
  }

  enum DeveloperDataIDField {
    static let developerID = 0
    static let applicationID = 1
    static let developerDataIndex = 3
  }

  enum FieldDescriptionField {
    static let developerDataIndex = 0
    static let fieldNumber = 1
    static let baseType = 2
    static let fieldName = 3
    static let units = 8
    static let nativeMessageNumber = 15
  }

  enum EventField {
    static let event = 0
    static let eventType = 1
  }

  enum WorkoutField {
    static let sport = 4
    static let name = 8
  }

  enum RecordField {
    static let heartRate = 3
    static let cadence = 4
    static let distance = 5
    static let speed = 6
    static let power = 7
  }

  enum LapField {
    static let startTime = 2
    static let totalElapsedTime = 7
    static let totalTimerTime = 8
  }

  enum SessionField {
    static let startTime = 2
    static let sport = 5
    static let subSport = 6
    static let totalElapsedTime = 7
    static let totalTimerTime = 8
    static let totalDistance = 9
    static let averageHeartRate = 16
    static let maxHeartRate = 17
    static let averagePower = 20
    static let maxPower = 21
    static let firstLapIndex = 25
    static let lapCount = 26
  }

  enum ActivityField {
    static let totalTimerTime = 0
    static let sessionCount = 1
    static let type = 2
    static let event = 3
    static let eventType = 4
  }

  enum FileType {
    static let activity: UInt8 = 4
  }

  enum Manufacturer {
    static let development: UInt16 = 255
  }

  enum Event {
    static let timer: UInt8 = 0
    static let session: UInt8 = 8
    static let lap: UInt8 = 9
    static let activity: UInt8 = 26
  }

  enum EventType {
    static let start: UInt8 = 0
    static let stop: UInt8 = 1
    static let stopAll: UInt8 = 4
  }

  enum ActivityType {
    static let manual: UInt8 = 0
  }

  enum Sport {
    static let generic = 0
    static let running = 1
    static let cycling = 2
    static let swimming = 5
    static let training = 10
    static let rowing = 15
  }

  enum SubSport {
    static let generic = 0
    static let indoorRowing = 14
    static let strengthTraining = 20
    static let virtualActivity = 58
  }

  enum Scale {
    static let distance = 100.0
    static let speed = 1000.0
    static let time = 1000.0
  }
}
