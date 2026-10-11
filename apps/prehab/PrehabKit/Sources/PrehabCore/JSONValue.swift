import Foundation

public enum JSONValue: Codable, Hashable, Sendable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case object([String: JSONValue])
  case array([JSONValue])
  case null
  public init(from decoder: any Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let v = try? c.decode(Bool.self) {
      self = .bool(v)
    } else if let v = try? c.decode(Double.self) {
      self = .number(v)
    } else if let v = try? c.decode(String.self) {
      self = .string(v)
    } else if let v = try? c.decode([JSONValue].self) {
      self = .array(v)
    } else {
      self = .object(try c.decode([String: JSONValue].self))
    }
  }
  public func encode(to encoder: any Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .string(let v): try c.encode(v)
    case .number(let v): try c.encode(v)
    case .bool(let v): try c.encode(v)
    case .object(let v): try c.encode(v)
    case .array(let v): try c.encode(v)
    case .null: try c.encodeNil()
    }
  }
  public subscript(key: String) -> JSONValue {
    if case .object(let v) = self { v[key] ?? .null } else { .null }
  }
  public var string: String? { if case .string(let v) = self { v } else { nil } }
  public var array: [JSONValue] { if case .array(let v) = self { v } else { [] } }
  public var bool: Bool { if case .bool(let v) = self { v } else { false } }
  public var object: [String: JSONValue] { if case .object(let v) = self { v } else { [:] } }
  public static func strings(_ values: [String]) -> JSONValue { .array(values.map(Self.string)) }
}
