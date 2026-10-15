import Foundation

public enum FITError: Error, Equatable, Sendable {
  case notAFITFile
  case truncated
  case badChecksum
  case noRecords
}

/// Decodes the parts of a FIT activity file that Ride shows: records, session and workout name.
///
/// FIT is a stream of definition messages, which describe a message layout, and data messages
/// that follow one. Everything else in the file is skipped without being interpreted.
public enum FITDecoder {
  public static func decode(_ data: Data) throws -> RideRecording {
    var reader = try MessageReader(data)
    var records: [Message] = []
    var session: Message?
    var workoutName: String?
    var targetPowerField: DeveloperField?
    while let message = try reader.next() {
      switch message.kind {
      case .record: records.append(message)
      case .session: session = session ?? message
      case .workout: workoutName = workoutName ?? message.string(8)
      case .fieldDescription:
        if message.string(3) == FITTargetPower.name, let index = message.integer(0),
          let number = message.integer(1)
        {
          targetPowerField = DeveloperField(index: index, number: number)
        }
      case .developerDataID, .other: break
      }
    }
    guard !records.isEmpty else { throw FITError.noRecords }
    return recording(
      records: records, session: session, workoutName: workoutName,
      targetPowerField: targetPowerField)
  }

  private static func recording(
    records: [Message], session: Message?, workoutName: String?,
    targetPowerField: DeveloperField?
  ) -> RideRecording {
    let startTimestamp =
      session?.integer(2) ?? records.compactMap { $0.integer(253) }.first ?? 0
    let samples = records.compactMap { record -> RideRecording.Sample? in
      guard let timestamp = record.integer(253) else { return nil }
      return RideRecording.Sample(
        elapsed: TimeInterval(timestamp - startTimestamp),
        power: record.integer(7),
        targetPower: targetPowerField.flatMap { record.developer[$0] },
        heartRate: record.integer(3),
        cadence: record.integer(4),
        speed: record.integer(6).map { Double($0) / 1000 },
        distance: record.integer(5).map { Double($0) / 100 })
    }

    let powers = samples.compactMap(\.power)
    let heartRates = samples.compactMap(\.heartRate)
    let summary = RideRecording.Summary(
      duration: session?.integer(7).map { TimeInterval($0) / 1000 }
        ?? samples.last?.elapsed ?? 0,
      distance: session?.integer(9).map { Double($0) / 100 }
        ?? samples.compactMap(\.distance).last,
      averagePower: session?.integer(20) ?? mean(powers),
      maxPower: session?.integer(21) ?? powers.max(),
      averageHeartRate: session?.integer(16) ?? mean(heartRates),
      maxHeartRate: session?.integer(17) ?? heartRates.max())

    return RideRecording(
      startDate: Date(timeIntervalSince1970: TimeInterval(startTimestamp) + fitEpoch),
      workoutName: workoutName,
      sport: session?.integer(5).flatMap { Sport(fitSport: $0, subSport: session?.integer(6)) },
      samples: samples, summary: summary)
  }

  /// Whether Ride recorded the file, rather than another app whose file was opened in Ride.
  /// Ride names itself as the application of the developer fields it writes.
  public static func isRecordedByRide(_ data: Data) -> Bool {
    guard var reader = try? MessageReader(data) else { return false }
    while let message = try? reader.next() {
      if message.kind == .developerDataID, message.bytes(1) == FITEncoder.applicationID {
        return true
      }
    }
    return false
  }

  private static func mean(_ values: [Int]) -> Int? {
    values.isEmpty ? nil : Int((Double(values.reduce(0, +)) / Double(values.count)).rounded())
  }

  /// FIT timestamps count seconds from 1989-12-31 00:00:00 UTC.
  private static let fitEpoch: TimeInterval = 631_065_600
}

// MARK: - Message stream

private struct Message {
  enum Kind { case record, session, workout, fieldDescription, developerDataID, other }

  let kind: Kind
  let fields: [Int: Field]
  /// The integer developer fields the message carries.
  var developer: [DeveloperField: Int] = [:]

  enum Field {
    case integer(Int)
    case string(String)
    case bytes([UInt8])
  }

  func integer(_ number: Int) -> Int? {
    if case .integer(let value) = fields[number] { value } else { nil }
  }

  func string(_ number: Int) -> String? {
    if case .string(let value) = fields[number] { value } else { nil }
  }

  func bytes(_ number: Int) -> [UInt8]? {
    if case .bytes(let value) = fields[number] { value } else { nil }
  }
}

private struct FieldDefinition {
  let number: Int
  let size: Int
  let baseType: Int
}

/// A field an application defined for itself, named by a `field_description` message.
private struct DeveloperField: Hashable {
  let index: Int
  let number: Int
}

private struct DeveloperFieldDefinition {
  let field: DeveloperField
  let size: Int
}

private struct Definition {
  let globalNumber: Int
  let bigEndian: Bool
  let fields: [FieldDefinition]
  let developerFields: [DeveloperFieldDefinition]
}

private struct MessageReader {
  let bytes: [UInt8]
  var position: Int
  let end: Int
  var definitions: [Int: Definition] = [:]
  var lastTimestamp = 0

  /// Checks the file's header and checksum, and starts at its first message.
  init(_ data: Data) throws {
    let bytes = [UInt8](data)
    guard bytes.count >= 14 else { throw FITError.truncated }
    let headerSize = Int(bytes[0])
    guard headerSize >= 12, bytes.count >= headerSize, bytes[8..<12] == [0x2E, 0x46, 0x49, 0x54]
    else { throw FITError.notAFITFile }

    let dataSize = Int(readInteger(bytes, at: 4, size: 4, bigEndian: false))
    let end = headerSize + dataSize
    guard bytes.count >= end + 2 else { throw FITError.truncated }
    let storedChecksum = UInt16(readInteger(bytes, at: end, size: 2, bigEndian: false))
    guard fitChecksum(bytes[0..<end]) == storedChecksum else { throw FITError.badChecksum }

    self.bytes = bytes
    position = headerSize
    self.end = end
  }

  /// The next data message, or nil at the end of the data section.
  mutating func next() throws -> Message? {
    while position < end {
      let header = try byte()
      if header & 0x80 != 0 {
        // Compressed timestamp header: a data message with a 5-bit time offset.
        guard let definition = definitions[Int((header >> 5) & 0x03)] else {
          throw FITError.truncated
        }
        var message = try data(definition)
        let offset = Int(header & 0x1F)
        var timestamp = (lastTimestamp & ~0x1F) + offset
        if offset < lastTimestamp & 0x1F { timestamp += 0x20 }
        lastTimestamp = timestamp
        message = message.settingTimestamp(timestamp)
        return message
      }
      let localType = Int(header & 0x0F)
      if header & 0x40 != 0 {
        definitions[localType] = try definition(hasDeveloperFields: header & 0x20 != 0)
        continue
      }
      guard let definition = definitions[localType] else { throw FITError.truncated }
      let message = try data(definition)
      if let timestamp = message.integer(253) { lastTimestamp = timestamp }
      return message
    }
    return nil
  }

  private mutating func definition(hasDeveloperFields: Bool) throws -> Definition {
    position += 1  // reserved
    let bigEndian = try byte() == 1
    let globalNumber = Int(try integer(size: 2, bigEndian: bigEndian))
    let fieldCount = Int(try byte())
    var fields: [FieldDefinition] = []
    for _ in 0..<fieldCount {
      fields.append(
        FieldDefinition(
          number: Int(try byte()), size: Int(try byte()), baseType: Int(try byte() & 0x1F)))
    }
    var developerFields: [DeveloperFieldDefinition] = []
    if hasDeveloperFields {
      for _ in 0..<Int(try byte()) {
        let number = Int(try byte())
        let size = Int(try byte())
        let index = Int(try byte())
        developerFields.append(
          DeveloperFieldDefinition(field: DeveloperField(index: index, number: number), size: size))
      }
    }
    return Definition(
      globalNumber: globalNumber, bigEndian: bigEndian, fields: fields,
      developerFields: developerFields)
  }

  private mutating func data(_ definition: Definition) throws -> Message {
    var fields: [Int: Message.Field] = [:]
    for field in definition.fields {
      guard position + field.size <= end else { throw FITError.truncated }
      if let value = FITValue.decode(
        bytes, at: position, size: field.size, baseType: field.baseType,
        bigEndian: definition.bigEndian)
      {
        fields[field.number] = value
      }
      position += field.size
    }
    var developer: [DeveloperField: Int] = [:]
    for field in definition.developerFields {
      guard position + field.size <= end else { throw FITError.truncated }
      if (1...4).contains(field.size) {
        let raw = readInteger(
          bytes, at: position, size: field.size, bigEndian: definition.bigEndian)
        // All ones marks a value as invalid.
        if raw != (UInt64(1) << UInt64(field.size * 8)) - 1 { developer[field.field] = Int(raw) }
      }
      position += field.size
    }
    let kind: Message.Kind =
      switch definition.globalNumber {
      case 20: .record
      case 18: .session
      case 26: .workout
      case 206: .fieldDescription
      case 207: .developerDataID
      default: .other
      }
    return Message(kind: kind, fields: fields, developer: developer)
  }

  private mutating func byte() throws -> UInt8 {
    guard position < end else { throw FITError.truncated }
    defer { position += 1 }
    return bytes[position]
  }

  private mutating func integer(size: Int, bigEndian: Bool) throws -> UInt64 {
    guard position + size <= end else { throw FITError.truncated }
    defer { position += size }
    return readInteger(bytes, at: position, size: size, bigEndian: bigEndian)
  }
}

extension Message {
  fileprivate func settingTimestamp(_ timestamp: Int) -> Message {
    var fields = fields
    fields[253] = .integer(timestamp)
    return Message(kind: kind, fields: fields, developer: developer)
  }
}

private enum FITValue {
  /// A single integer, string or byte array field, or nil when the field is another kind of
  /// array, floats, or holds the base type's "invalid" marker.
  static func decode(
    _ bytes: [UInt8], at position: Int, size: Int, baseType: Int, bigEndian: Bool
  ) -> Message.Field? {
    switch baseType {
    case 7:
      let raw = bytes[position..<position + size].prefix { $0 != 0 }
      return raw.isEmpty ? nil : .string(String(decoding: raw, as: UTF8.self))
    case 13 where size > 1:
      let raw = Array(bytes[position..<position + size])
      return raw.allSatisfy { $0 == 0xFF } ? nil : .bytes(raw)
    case 0, 2, 13: return integer(bytes, position, size, 1, signed: false, bigEndian)
    case 1: return integer(bytes, position, size, 1, signed: true, bigEndian)
    case 3: return integer(bytes, position, size, 2, signed: true, bigEndian)
    case 4: return integer(bytes, position, size, 2, signed: false, bigEndian)
    case 5: return integer(bytes, position, size, 4, signed: true, bigEndian)
    case 6: return integer(bytes, position, size, 4, signed: false, bigEndian)
    case 10: return integer(bytes, position, size, 1, signed: false, bigEndian, invalid: 0)
    case 11: return integer(bytes, position, size, 2, signed: false, bigEndian, invalid: 0)
    case 12: return integer(bytes, position, size, 4, signed: false, bigEndian, invalid: 0)
    default: return nil
    }
  }

  private static func integer(
    _ bytes: [UInt8], _ position: Int, _ size: Int, _ width: Int, signed: Bool,
    _ bigEndian: Bool, invalid: UInt64? = nil
  ) -> Message.Field? {
    guard size == width else { return nil }
    let raw = readInteger(bytes, at: position, size: width, bigEndian: bigEndian)
    let bits = UInt64(width * 8)
    let invalidValue =
      invalid ?? (signed ? (UInt64(1) << (bits - 1)) - 1 : (UInt64(1) << bits) - 1)
    guard raw != invalidValue else { return nil }
    if signed, raw >> (bits - 1) == 1 {
      return .integer(Int(raw) - (1 << Int(bits)))
    }
    return .integer(Int(raw))
  }
}

private func readInteger(_ bytes: [UInt8], at position: Int, size: Int, bigEndian: Bool) -> UInt64 {
  var value: UInt64 = 0
  for index in 0..<size {
    let byte = UInt64(bytes[bigEndian ? position + index : position + size - 1 - index])
    value = value << 8 | byte
  }
  return value
}

func fitChecksum(_ bytes: ArraySlice<UInt8>) -> UInt16 {
  let table: [UInt16] = [
    0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
    0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
  ]
  var crc: UInt16 = 0
  for byte in bytes {
    var tmp = table[Int(crc & 0xF)]
    crc = (crc >> 4) & 0x0FFF
    crc = crc ^ tmp ^ table[Int(byte & 0xF)]
    tmp = table[Int(crc & 0xF)]
    crc = (crc >> 4) & 0x0FFF
    crc = crc ^ tmp ^ table[Int((byte >> 4) & 0xF)]
  }
  return crc
}
