import Foundation

/// The developer field that carries a sample's target power. FIT has no record field for it, so
/// the encoder defines one and the decoder looks it up by name.
enum FITTargetPower {
  static let name = "target_power"
  static let developerIndex = 0
  static let fieldNumber = 0
}

/// Writes a finished ride as a FIT activity file, the inverse of `FITDecoder`.
///
/// The file has one session, one lap and a record per sample. Missing readings are left as the
/// base type's "invalid" marker, which readers skip.
public enum FITEncoder {
  public static func encode(_ recording: RideRecording) -> Data {
    var writer = FITWriter()
    let start = fitTimestamp(recording.startDate)
    let records = uniqueSeconds(of: recording, from: start)
    let end = max(
      start + UInt32(recording.summary.duration.rounded()), records.last?.timestamp ?? start)
    let duration = UInt32((recording.summary.duration * 1000).rounded())
    let summary = recording.summary
    let fit = recording.sport?.fitSport ?? (sport: 0, subSport: 0)

    writer.message(
      local: 0, global: 0,
      [
        .enumeration(0, 4),  // type: activity
        .uint16(1, 255),  // manufacturer: development
        .uint16(2, 0),  // product
        .uint32(4, start),  // time_created
      ])
    writer.message(
      local: 1, global: 207,
      [
        .bytes(0, applicationID),  // developer_id
        .bytes(1, applicationID),  // application_id
        .uint8(3, UInt8(FITTargetPower.developerIndex)),
      ])
    writer.message(
      local: 2, global: 206,
      [
        .uint8(0, UInt8(FITTargetPower.developerIndex)),
        .uint8(1, UInt8(FITTargetPower.fieldNumber)),
        .uint8(2, 0x84),  // base type: uint16
        .string(3, FITTargetPower.name),
        .string(8, "watts"),
        .uint16(15, 20),  // native message: record
      ])
    writer.message(
      local: 3, global: 21,
      [.uint32(253, start), .enumeration(0, 0), .enumeration(1, 0)])  // timer start
    if let name = recording.workoutName {
      writer.message(
        local: 4, global: 26, [.enumeration(4, UInt8(fit.sport)), .string(8, name)])
    }

    let recordFields: [FITWriter.Field] = [
      .uint32(253, 0), .uint8(3, 0), .uint8(4, 0), .uint32(5, 0), .uint16(6, 0), .uint16(7, 0),
    ]
    writer.definition(
      local: 5, global: 20, recordFields,
      developer: [
        (
          number: UInt8(FITTargetPower.fieldNumber), size: 2,
          index: UInt8(FITTargetPower.developerIndex)
        )
      ])
    for (sample, timestamp) in records {
      writer.data(
        local: 5,
        [
          .uint32(253, timestamp),
          .uint8(3, sample.heartRate.map { UInt8(clamping: $0) } ?? invalid8),
          .uint8(4, sample.cadence.map { UInt8(clamping: $0) } ?? invalid8),
          .uint32(
            5, sample.distance.map { UInt32(clamping: Int(($0 * 100).rounded())) } ?? invalid32),
          .uint16(
            6, sample.speed.map { UInt16(clamping: Int(($0 * 1000).rounded())) } ?? invalid16),
          .uint16(7, sample.power.map { UInt16(clamping: $0) } ?? invalid16),
        ],
        developer: sample.targetPower.map { UInt16(clamping: $0) } ?? invalid16)
    }

    writer.message(
      local: 3, global: 21,
      [.uint32(253, end), .enumeration(0, 0), .enumeration(1, 4)])  // timer stop all
    writer.message(
      local: 6, global: 19,
      [
        .uint32(253, end), .uint32(2, start), .enumeration(0, 9), .enumeration(1, 1),
        .uint32(7, duration), .uint32(8, duration),
      ])
    writer.message(
      local: 7, global: 18,
      [
        .uint16(254, 0), .uint32(253, end), .uint32(2, start), .enumeration(0, 8),
        .enumeration(1, 1), .enumeration(5, UInt8(fit.sport)), .enumeration(6, UInt8(fit.subSport)),
        .uint32(7, duration), .uint32(8, duration),
        .uint32(
          9, summary.distance.map { UInt32(clamping: Int(($0 * 100).rounded())) } ?? invalid32),
        .uint8(16, summary.averageHeartRate.map { UInt8(clamping: $0) } ?? invalid8),
        .uint8(17, summary.maxHeartRate.map { UInt8(clamping: $0) } ?? invalid8),
        .uint16(20, summary.averagePower.map { UInt16(clamping: $0) } ?? invalid16),
        .uint16(21, summary.maxPower.map { UInt16(clamping: $0) } ?? invalid16),
        .uint16(25, 0), .uint16(26, 1),
      ])
    writer.message(
      local: 8, global: 34,
      [
        .uint32(253, end), .uint32(0, duration), .uint16(1, 1), .enumeration(2, 0),
        .enumeration(3, 26), .enumeration(4, 1),
      ])

    return writer.file()
  }

  /// The samples with the FIT timestamp of each, dropping one that would share its second with
  /// the sample before it, since a second can hold only one record.
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
    UInt32(clamping: Int(date.timeIntervalSince1970.rounded()) - fitEpoch)
  }

  /// FIT timestamps count seconds from 1989-12-31 00:00:00 UTC.
  static let fitEpoch = 631_065_600

  /// Names the application that defined the developer field: 16 bytes of ASCII.
  private static let applicationID = Array("trainstack-ride!".utf8)

  private static let invalid8 = UInt8.max
  private static let invalid16 = UInt16.max
  private static let invalid32 = UInt32.max
}

// MARK: - Writing

private struct FITWriter {
  /// One field of a message: its number and value, from which the base type and size follow.
  enum Field {
    case enumeration(UInt8, UInt8)
    case uint8(UInt8, UInt8)
    case uint16(UInt8, UInt16)
    case uint32(UInt8, UInt32)
    case string(UInt8, String)
    case bytes(UInt8, [UInt8])

    var number: UInt8 {
      switch self {
      case .enumeration(let number, _), .uint8(let number, _), .uint16(let number, _),
        .uint32(let number, _), .string(let number, _), .bytes(let number, _):
        number
      }
    }

    var baseType: UInt8 {
      switch self {
      case .enumeration: 0x00
      case .uint8: 0x02
      case .uint16: 0x84
      case .uint32: 0x86
      case .string: 0x07
      case .bytes: 0x0D
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

    /// The text cut to fit a field, as a string field ends in a zero byte and no more than 255
    /// bytes can be described.
    private static func nullTerminated(_ text: String) -> [UInt8] {
      var bytes: [UInt8] = []
      for character in text {
        let encoded = Array(String(character).utf8)
        if bytes.count + encoded.count > 254 { break }
        bytes += encoded
      }
      return bytes + [0]
    }
  }

  private var body: [UInt8] = []

  /// A definition followed by its one data message.
  mutating func message(local: UInt8, global: UInt16, _ fields: [Field]) {
    definition(local: local, global: global, fields)
    data(local: local, fields)
  }

  mutating func definition(
    local: UInt8, global: UInt16, _ fields: [Field],
    developer: [(number: UInt8, size: UInt8, index: UInt8)] = []
  ) {
    body.append(0x40 | (developer.isEmpty ? 0 : 0x20) | local)
    body += [0, 0]  // reserved, little endian
    body += withUnsafeBytes(of: global.littleEndian, Array.init)
    body.append(UInt8(fields.count))
    for field in fields { body += [field.number, UInt8(field.encoded.count), field.baseType] }
    if !developer.isEmpty {
      body.append(UInt8(developer.count))
      for field in developer { body += [field.number, field.size, field.index] }
    }
  }

  /// A data message for the definition of `local`, followed by one developer field value if the
  /// definition has it.
  mutating func data(local: UInt8, _ fields: [Field], developer: UInt16? = nil) {
    body.append(local)
    for field in fields { body += field.encoded }
    if let developer { body += withUnsafeBytes(of: developer.littleEndian, Array.init) }
  }

  /// The complete file: header, messages and checksum.
  func file() -> Data {
    var header: [UInt8] = [14, 0x20]
    header += withUnsafeBytes(of: UInt16(2140).littleEndian, Array.init)  // profile 21.40
    header += withUnsafeBytes(of: UInt32(body.count).littleEndian, Array.init)
    header += Array(".FIT".utf8)
    header += withUnsafeBytes(of: fitChecksum(header[...]).littleEndian, Array.init)
    let content = header + body
    return Data(content + withUnsafeBytes(of: fitChecksum(content[...]).littleEndian, Array.init))
  }
}
