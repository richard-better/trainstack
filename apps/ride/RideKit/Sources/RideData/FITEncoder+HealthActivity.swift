import Foundation

extension FITEncoder {
  public static func encode(_ activity: HealthActivity) -> Data {
    typealias Number = FITProfile.MessageNumber
    typealias Event = FITProfile.Event
    typealias EventType = FITProfile.EventType
    typealias EventField = FITProfile.EventField
    let timestamp = FITProfile.CommonField.timestamp
    var writer = FITWriter()
    let start = fitTimestamp(activity.startDate)
    let end = max(start, fitTimestamp(activity.endDate))
    let pauses = pausedSpans(of: activity, from: start, to: end)
    let elapsed = end - start
    let paused = pauses.reduce(UInt32(0)) { $0 + ($1.upperBound - $1.lowerBound) }
    let elapsedTime = UInt32(Double(elapsed) * FITProfile.Scale.time)
    let timerTime = UInt32(Double(elapsed - min(paused, elapsed)) * FITProfile.Scale.time)
    let distance = activity.totalDistanceMetres ?? activity.distanceSoFar.map(\.value).max()
    let fit = activity.sport.fit
    let ascent = activity.ascentMetres.map { UInt16(clamping: Int($0.rounded())) } ?? invalid16

    typealias FileID = FITProfile.FileIDField
    writer.message(
      local: 0, global: Number.fileID,
      [
        .enumeration(FileID.type, FITProfile.FileType.activity),
        .uint16(FileID.manufacturer, FITProfile.Manufacturer.development),
        .uint16(FileID.product, 0),
        .uint32(FileID.timeCreated, start),
      ])
    let timerEvent: (UInt32, UInt8) -> [FITWriter.Field] = { time, type in
      [
        .uint32(timestamp, time), .enumeration(EventField.event, Event.timer),
        .enumeration(EventField.eventType, type),
      ]
    }
    let timerEvents =
      [(start, EventType.start)]
      + pauses.flatMap { [($0.lowerBound, EventType.stopAll), ($0.upperBound, EventType.start)] }
      + [(end, EventType.stopAll)]
    writer.definition(local: 1, global: Number.event, timerEvent(start, EventType.start))

    typealias Record = FITProfile.RecordField
    let records = rows(of: activity, from: start, to: end)
    let recordFields: (HealthRow) -> [FITWriter.Field] = { row in
      [
        .uint32(timestamp, row.timestamp),
        .sint32(Record.positionLat, semicircles(row.location?.latitude)),
        .sint32(Record.positionLong, semicircles(row.location?.longitude)),
        .uint8(Record.heartRate, row.heartRate.map { UInt8(clamping: Int($0.rounded())) } ?? invalid8),
        .uint8(Record.cadence, row.cadence.map { UInt8(clamping: Int($0.rounded())) } ?? invalid8),
        .uint32(Record.distance, scaledDistance(row.distance)),
        .uint16(
          Record.speed,
          row.speed.map { UInt16(clamping: Int(($0 * FITProfile.Scale.speed).rounded())) }
            ?? invalid16),
        .uint16(Record.power, row.power.map { UInt16(clamping: Int($0.rounded())) } ?? invalid16),
        .uint32(Record.enhancedAltitude, scaledAltitude(row.location?.altitudeMetres)),
      ]
    }
    if let first = records.first {
      writer.definition(local: 2, global: Number.record, recordFields(first))
    }
    var nextEvent = 0
    for row in records {
      while nextEvent < timerEvents.count, timerEvents[nextEvent].0 <= row.timestamp {
        writer.data(local: 1, timerEvent(timerEvents[nextEvent].0, timerEvents[nextEvent].1))
        nextEvent += 1
      }
      writer.data(local: 2, recordFields(row))
    }
    for (time, type) in timerEvents[nextEvent...] {
      writer.data(local: 1, timerEvent(time, type))
    }

    typealias Lap = FITProfile.LapField
    writer.message(
      local: 3, global: Number.lap,
      [
        .uint16(FITProfile.CommonField.messageIndex, 0), .uint32(timestamp, end),
        .uint32(Lap.startTime, start), .enumeration(EventField.event, Event.lap),
        .enumeration(EventField.eventType, EventType.stop),
        .uint32(Lap.totalElapsedTime, elapsedTime), .uint32(Lap.totalTimerTime, timerTime),
        .uint32(Lap.totalDistance, scaledDistance(distance)), .uint16(Lap.totalAscent, ascent),
        .enumeration(Lap.lapTrigger, UInt8(FITProfile.LapTriggerValue.sessionEnd)),
      ])
    typealias Session = FITProfile.SessionField
    writer.message(
      local: 4, global: Number.session,
      [
        .uint16(FITProfile.CommonField.messageIndex, 0), .uint32(timestamp, end),
        .uint32(Session.startTime, start), .enumeration(EventField.event, Event.session),
        .enumeration(EventField.eventType, EventType.stop),
        .enumeration(Session.sport, UInt8(fit.sport)),
        .enumeration(Session.subSport, UInt8(fit.subSport)),
        .uint32(Session.totalElapsedTime, elapsedTime), .uint32(Session.totalTimerTime, timerTime),
        .uint32(Session.totalDistance, scaledDistance(distance)),
        .uint16(
          Session.totalCalories,
          activity.activeKilocalories.map { UInt16(clamping: Int($0.rounded())) } ?? invalid16),
        .uint16(Session.totalAscent, ascent),
        .uint16(Session.firstLapIndex, 0), .uint16(Session.lapCount, 1),
      ])
    typealias Activity = FITProfile.ActivityField
    writer.message(
      local: 5, global: Number.activity,
      [
        .uint32(timestamp, end), .uint32(Activity.totalTimerTime, timerTime),
        .uint16(Activity.sessionCount, 1),
        .enumeration(Activity.type, FITProfile.ActivityType.manual),
        .enumeration(Activity.event, Event.activity),
        .enumeration(Activity.eventType, EventType.stop),
      ] + localTimestamp(at: end, offsetSeconds: activity.utcOffsetSeconds))
    return writer.file()
  }

  private struct HealthRow {
    var timestamp: UInt32
    var heartRate: Double?
    var power: Double?
    var cadence: Double?
    var speed: Double?
    var distance: Double?
    var location: HealthActivity.Location?
  }

  private struct HeldChannel {
    private let readings: [(timestamp: UInt32, value: Double)]
    private let longestHold: UInt32?
    private var next = 0

    init(_ readings: [HealthActivity.Reading], from start: UInt32, longestHold: UInt32?) {
      self.readings = readings.map { (fitTimestamp($0.date), $0.value) }
        .filter { $0.timestamp >= start && $0.value.isFinite }
        .sorted { ($0.timestamp, $0.value) < ($1.timestamp, $1.value) }
      self.longestHold = longestHold
    }

    var timestamps: [UInt32] { readings.map(\.timestamp) }

    mutating func value(at timestamp: UInt32) -> Double? {
      while next < readings.count, readings[next].timestamp <= timestamp { next += 1 }
      guard next > 0 else { return nil }
      let latest = readings[next - 1]
      if let longestHold, timestamp - latest.timestamp > longestHold { return nil }
      return latest.value
    }
  }

  private static func rows(of activity: HealthActivity, from start: UInt32, to end: UInt32)
    -> [HealthRow]
  {
    let hold = UInt32(SamplingRule.maxHeldGap)
    var heartRate = HeldChannel(activity.heartRate, from: start, longestHold: hold)
    var power = HeldChannel(activity.power, from: start, longestHold: hold)
    var cadence = HeldChannel(activity.cadence, from: start, longestHold: hold)
    var speed = HeldChannel(activity.speed, from: start, longestHold: hold)
    var distance = HeldChannel(activity.distanceSoFar, from: start, longestHold: nil)
    var locations: [UInt32: HealthActivity.Location] = [:]
    for location in activity.locations.sorted(by: isEarlier)
    where location.latitude.isFinite && location.longitude.isFinite {
      locations[fitTimestamp(location.date)] = location
    }
    let timestamps = Set(
      heartRate.timestamps + power.timestamps + cadence.timestamps + speed.timestamps
        + distance.timestamps + locations.keys
    ).filter { $0 >= start && $0 <= end }.sorted()
    return timestamps.map { timestamp in
      let location = locations[timestamp]
      let measuredSpeed = location?.speedMetresPerSecond.flatMap { $0 >= 0 ? $0 : nil }
      let heldSpeed = speed.value(at: timestamp)
      return HealthRow(
        timestamp: timestamp, heartRate: heartRate.value(at: timestamp),
        power: power.value(at: timestamp), cadence: cadence.value(at: timestamp),
        speed: measuredSpeed ?? heldSpeed, distance: distance.value(at: timestamp),
        location: location)
    }
  }

  private static func isEarlier(_ a: HealthActivity.Location, _ b: HealthActivity.Location)
    -> Bool
  {
    (a.date, a.latitude, a.longitude) < (b.date, b.latitude, b.longitude)
  }

  private static func pausedSpans(of activity: HealthActivity, from start: UInt32, to end: UInt32)
    -> [Range<UInt32>]
  {
    let spans = activity.pauses
      .map { min(max(fitTimestamp($0.from), start), end)..<min(max(fitTimestamp($0.to), start), end) }
      .filter { !$0.isEmpty }
      .sorted { ($0.lowerBound, $0.upperBound) < ($1.lowerBound, $1.upperBound) }
    var merged: [Range<UInt32>] = []
    for span in spans {
      if let last = merged.last, span.lowerBound <= last.upperBound {
        merged[merged.count - 1] = last.lowerBound..<max(last.upperBound, span.upperBound)
      } else {
        merged.append(span)
      }
    }
    return merged
  }

  private static func semicircles(_ degrees: Double?) -> Int32 {
    guard let degrees, degrees.isFinite, abs(degrees) <= 180 else { return Int32.max }
    return Int32(clamping: Int((degrees * FITProfile.Scale.semicirclesPerDegree).rounded()))
  }

  private static func scaledAltitude(_ metres: Double?) -> UInt32 {
    guard let metres, metres.isFinite else { return invalid32 }
    let scaled = ((metres + FITProfile.altitudeOffsetMetres) * FITProfile.Scale.altitude).rounded()
    return scaled < 0 ? invalid32 : UInt32(clamping: Int(scaled))
  }
}
