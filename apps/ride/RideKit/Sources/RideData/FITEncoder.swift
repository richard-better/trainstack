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
    let laps =
      recording.laps.isEmpty
      ? [
        RideLap(
          from: 0, to: summary.duration, trigger: .sessionEnd, stepIndex: nil,
          samples: recording.samples)
      ] : recording.laps
    writer.definition(local: 6, global: Number.lap, lapFields(laps[0], index: 0, start: start))
    for (index, lap) in laps.enumerated() {
      writer.data(local: 6, lapFields(lap, index: index, start: start))
    }
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
        .uint16(Session.firstLapIndex, 0), .uint16(Session.lapCount, UInt16(clamping: laps.count)),
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
      ] + localTimestamp(at: end, offsetSeconds: recording.utcOffsetSeconds))

    return writer.file()
  }

  private static func localTimestamp(at timestamp: UInt32, offsetSeconds: Int?) -> [FITWriter.Field]
  {
    guard let offsetSeconds, abs(offsetSeconds) <= FITProfile.longestUTCOffsetSeconds else {
      return []
    }
    return [
      .uint32(
        FITProfile.ActivityField.localTimestamp,
        UInt32(clamping: Int(timestamp) + offsetSeconds))
    ]
  }

  private static func lapFields(_ lap: RideLap, index: Int, start: UInt32) -> [FITWriter.Field] {
    typealias Lap = FITProfile.LapField
    let lapStart = start + UInt32(clamping: Int(lap.start.rounded()))
    let lapEnd = start + UInt32(clamping: Int(lap.end.rounded()))
    let duration = UInt32(clamping: Int((lap.duration * FITProfile.Scale.time).rounded()))
    return [
      .uint16(FITProfile.CommonField.messageIndex, UInt16(clamping: index)),
      .uint32(FITProfile.CommonField.timestamp, lapEnd), .uint32(Lap.startTime, lapStart),
      .enumeration(FITProfile.EventField.event, FITProfile.Event.lap),
      .enumeration(FITProfile.EventField.eventType, FITProfile.EventType.stop),
      .uint32(Lap.totalElapsedTime, duration), .uint32(Lap.totalTimerTime, duration),
      .uint32(Lap.totalDistance, scaledDistance(lap.distanceMetres)),
      .uint8(Lap.averageHeartRate, lap.averageHeartRate.map { UInt8(clamping: $0) } ?? invalid8),
      .uint8(Lap.maxHeartRate, lap.maxHeartRate.map { UInt8(clamping: $0) } ?? invalid8),
      .uint8(Lap.averageCadence, lap.averageCadence.map { UInt8(clamping: $0) } ?? invalid8),
      .uint16(Lap.averagePower, lap.averagePower.map { UInt16(clamping: $0) } ?? invalid16),
      .uint16(Lap.maxPower, lap.maxPower.map { UInt16(clamping: $0) } ?? invalid16),
      .enumeration(Lap.lapTrigger, lap.trigger.fit),
      .uint16(Lap.workoutStepIndex, lap.stepIndex.map { UInt16(clamping: $0) } ?? invalid16),
    ]
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
