import Foundation

struct FITWriter {
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
