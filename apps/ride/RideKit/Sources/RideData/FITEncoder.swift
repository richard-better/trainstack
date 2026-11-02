import Foundation

public enum FITEncoder {
  public static func encode(_ recording: RideRecording) -> Data {
    typealias Number = FITProfile.MessageNumber
    typealias Event = FITProfile.Event
    typealias EventType = FITProfile.EventType
    typealias EventField = FITProfile.EventField
    let timestamp = FITProfile.CommonField.timestamp
    var writer = FITWriter()
    let start = fitTimestamp(recording.startDate)
    let records = uniqueSeconds(of: recording, from: start)
    let end = max(
      start + UInt32(recording.summary.duration.rounded()), records.last?.timestamp ?? start)
    let duration = UInt32((recording.summary.duration * FITProfile.Scale.time).rounded())
    let summary = recording.summary
    let fit =
      recording.sport?.fitSport ?? (
        sport: FITProfile.Sport.generic, subSport: FITProfile.SubSport.generic
      )

    typealias FileID = FITProfile.FileIDField
    writer.message(
      local: 0, global: Number.fileID,
      [
        .enumeration(FileID.type, FITProfile.FileType.activity),
        .uint16(FileID.manufacturer, FITProfile.Manufacturer.development),
        .uint16(FileID.product, 0),
        .uint32(FileID.timeCreated, start),
      ])
    typealias DeveloperDataID = FITProfile.DeveloperDataIDField
    writer.message(
      local: 1, global: Number.developerDataID,
      [
        .bytes(DeveloperDataID.developerID, applicationID),
        .bytes(DeveloperDataID.applicationID, applicationID),
        .uint8(
          DeveloperDataID.developerDataIndex, UInt8(FITTargetPowerDeveloperField.developerIndex)),
      ])
    typealias FieldDescription = FITProfile.FieldDescriptionField
    writer.message(
      local: 2, global: Number.fieldDescription,
      [
        .uint8(
          FieldDescription.developerDataIndex, UInt8(FITTargetPowerDeveloperField.developerIndex)),
        .uint8(FieldDescription.fieldNumber, UInt8(FITTargetPowerDeveloperField.fieldNumber)),
        .uint8(FieldDescription.baseType, FITProfile.BaseType.uint16),
        .string(FieldDescription.fieldName, FITTargetPowerDeveloperField.name),
        .string(FieldDescription.units, FITTargetPowerDeveloperField.units),
        .uint16(FieldDescription.nativeMessageNumber, UInt16(Number.record)),
      ])
    writer.message(
      local: 3, global: Number.event,
      [
        .uint32(timestamp, start), .enumeration(EventField.event, Event.timer),
        .enumeration(EventField.eventType, EventType.start),
      ])
    if let name = recording.workoutName {
      writer.message(
        local: 4, global: Number.workout,
        [
          .enumeration(FITProfile.WorkoutField.sport, UInt8(fit.sport)),
          .string(FITProfile.WorkoutField.name, name),
        ])
    }

    typealias Record = FITProfile.RecordField
    let recordFields: [FITWriter.Field] = [
      .uint32(timestamp, 0), .uint8(Record.heartRate, 0), .uint8(Record.cadence, 0),
      .uint32(Record.distance, 0), .uint16(Record.speed, 0), .uint16(Record.power, 0),
    ]
    writer.definition(
      local: 5, global: Number.record, recordFields,
      developer: [
        (
          number: UInt8(FITTargetPowerDeveloperField.fieldNumber), size: 2,
          index: UInt8(FITTargetPowerDeveloperField.developerIndex)
        )
      ])
    for (sample, sampleTimestamp) in records {
      writer.data(
        local: 5,
        [
          .uint32(timestamp, sampleTimestamp),
          .uint8(Record.heartRate, sample.heartRate.map { UInt8(clamping: $0) } ?? invalid8),
          .uint8(Record.cadence, sample.cadence.map { UInt8(clamping: $0) } ?? invalid8),
          .uint32(Record.distance, scaledDistance(sample.distanceMetres)),
          .uint16(
            Record.speed,
            sample.speedMetresPerSecond.map {
              UInt16(clamping: Int(($0 * FITProfile.Scale.speed).rounded()))
            } ?? invalid16),
          .uint16(Record.power, sample.power.map { UInt16(clamping: $0) } ?? invalid16),
        ],
        developer: sample.targetPower.map { UInt16(clamping: $0) } ?? invalid16)
    }

    writer.message(
      local: 3, global: Number.event,
      [
        .uint32(timestamp, end), .enumeration(EventField.event, Event.timer),
        .enumeration(EventField.eventType, EventType.stopAll),
      ])
    typealias Lap = FITProfile.LapField
    writer.message(
      local: 6, global: Number.lap,
      [
        .uint32(timestamp, end), .uint32(Lap.startTime, start),
        .enumeration(EventField.event, Event.lap),
        .enumeration(EventField.eventType, EventType.stop),
        .uint32(Lap.totalElapsedTime, duration), .uint32(Lap.totalTimerTime, duration),
      ])
    typealias Session = FITProfile.SessionField
    writer.message(
      local: 7, global: Number.session,
      [
        .uint16(FITProfile.CommonField.messageIndex, 0), .uint32(timestamp, end),
        .uint32(Session.startTime, start), .enumeration(EventField.event, Event.session),
        .enumeration(EventField.eventType, EventType.stop),
        .enumeration(Session.sport, UInt8(fit.sport)),
        .enumeration(Session.subSport, UInt8(fit.subSport)),
        .uint32(Session.totalElapsedTime, duration), .uint32(Session.totalTimerTime, duration),
        .uint32(Session.totalDistance, scaledDistance(summary.distanceMetres)),
        .uint8(
          Session.averageHeartRate, summary.averageHeartRate.map { UInt8(clamping: $0) } ?? invalid8
        ),
        .uint8(Session.maxHeartRate, summary.maxHeartRate.map { UInt8(clamping: $0) } ?? invalid8),
        .uint16(
          Session.averagePower, summary.averagePower.map { UInt16(clamping: $0) } ?? invalid16),
        .uint16(Session.maxPower, summary.maxPower.map { UInt16(clamping: $0) } ?? invalid16),
        .uint16(Session.firstLapIndex, 0), .uint16(Session.lapCount, 1),
      ])
    typealias Activity = FITProfile.ActivityField
    writer.message(
      local: 8, global: Number.activity,
      [
        .uint32(timestamp, end), .uint32(Activity.totalTimerTime, duration),
        .uint16(Activity.sessionCount, 1),
        .enumeration(Activity.type, FITProfile.ActivityType.manual),
        .enumeration(Activity.event, Event.activity),
        .enumeration(Activity.eventType, EventType.stop),
      ])

    return writer.file()
  }

  private static func scaledDistance(_ metres: Double?) -> UInt32 {
    metres.map { UInt32(clamping: Int(($0 * FITProfile.Scale.distance).rounded())) } ?? invalid32
  }

  private static func uniqueSeconds(
    of recording: RideRecording, from start: UInt32
  ) -> [(sample: RideRecording.Sample, timestamp: UInt32)] {
    var result: [(sample: RideRecording.Sample, timestamp: UInt32)] = []
    for sample in recording.samples {
      let timestamp = start + UInt32(clamping: Int(sample.elapsed.rounded()))
      guard result.last.map({ timestamp > $0.timestamp }) ?? true else { continue }
      result.append((sample, timestamp))
    }
    return result
  }

  private static func fitTimestamp(_ date: Date) -> UInt32 {
    UInt32(clamping: Int(date.timeIntervalSince1970.rounded()) - FITProfile.epochInUnixTime)
  }

  static let applicationID = Array("trainstack-ride!".utf8)

  private static let invalid8 = UInt8.max
  private static let invalid16 = UInt16.max
  private static let invalid32 = UInt32.max
}

private struct FITWriter {
  enum Field {
    case enumeration(Int, UInt8)
    case uint8(Int, UInt8)
    case uint16(Int, UInt16)
    case uint32(Int, UInt32)
    case string(Int, String)
    case bytes(Int, [UInt8])

    var number: UInt8 {
      switch self {
      case .enumeration(let number, _), .uint8(let number, _), .uint16(let number, _),
        .uint32(let number, _), .string(let number, _), .bytes(let number, _):
        UInt8(number)
      }
    }

    var baseType: UInt8 {
      switch self {
      case .enumeration: FITProfile.BaseType.enumeration
      case .uint8: FITProfile.BaseType.uint8
      case .uint16: FITProfile.BaseType.uint16
      case .uint32: FITProfile.BaseType.uint32
      case .string: FITProfile.BaseType.string
      case .bytes: FITProfile.BaseType.byteArray
      }
    }

    var encoded: [UInt8] {
      switch self {
      case .enumeration(_, let value), .uint8(_, let value): [value]
      case .uint16(_, let value): withUnsafeBytes(of: value.littleEndian, Array.init)
      case .uint32(_, let value): withUnsafeBytes(of: value.littleEndian, Array.init)
      case .string(_, let value): Self.nullTerminated(value)
      case .bytes(_, let value): value
      }
    }

    private static func nullTerminated(_ text: String) -> [UInt8] {
      let nullTerminator: [UInt8] = [0]
      var bytes: [UInt8] = []
      for character in text {
        let encoded = Array(String(character).utf8)
        let length = bytes.count + encoded.count + nullTerminator.count
        if length > FITProfile.longestStringFieldBytes { break }
        bytes += encoded
      }
      return bytes + nullTerminator
    }
  }

  private var body: [UInt8] = []

  mutating func message(local: UInt8, global: Int, _ fields: [Field]) {
    definition(local: local, global: global, fields)
    data(local: local, fields)
  }

  mutating func definition(
    local: UInt8, global: Int, _ fields: [Field],
    developer: [(number: UInt8, size: UInt8, index: UInt8)] = []
  ) {
    let reserved: UInt8 = 0
    let littleEndianArchitecture: UInt8 = 0
    body.append(0x40 | (developer.isEmpty ? 0 : 0x20) | local)
    body += [reserved, littleEndianArchitecture]
    body += withUnsafeBytes(of: UInt16(global).littleEndian, Array.init)
    body.append(UInt8(fields.count))
    for field in fields { body += [field.number, UInt8(field.encoded.count), field.baseType] }
    if !developer.isEmpty {
      body.append(UInt8(developer.count))
      for field in developer { body += [field.number, field.size, field.index] }
    }
  }

  mutating func data(local: UInt8, _ fields: [Field], developer: UInt16? = nil) {
    body.append(local)
    for field in fields { body += field.encoded }
    if let developer { body += withUnsafeBytes(of: developer.littleEndian, Array.init) }
  }

  func file() -> Data {
    var header: [UInt8] = [FITProfile.headerSize, FITProfile.protocolVersion]
    header += withUnsafeBytes(of: FITProfile.version.littleEndian, Array.init)
    header += withUnsafeBytes(of: UInt32(body.count).littleEndian, Array.init)
    header += Array(".FIT".utf8)
    header += withUnsafeBytes(of: fitChecksum(header[...]).littleEndian, Array.init)
    let content = header + body
    return Data(content + withUnsafeBytes(of: fitChecksum(content[...]).littleEndian, Array.init))
  }
}
