import Foundation
import RideData

public struct RideTrace: Equatable, Sendable {
  public struct Header: Equatable, Codable, Sendable {
    public var template: WorkoutTemplate
    public var ftp: Int
    public var startDate: Date
    public var riderWeight: Double

    public init(template: WorkoutTemplate, ftp: Int, startDate: Date, riderWeight: Double) {
      self.template = template
      self.ftp = ftp
      self.startDate = startDate
      self.riderWeight = riderWeight
    }
  }

  public var header: Header
  public var inputs: [RideInput]

  public init(header: Header, inputs: [RideInput] = []) {
    self.header = header
    self.inputs = inputs
  }

  public var name: String { header.template.name }

  public func freshSession() -> RideSession {
    RideSession(
      workout: header.template.workout(ftp: header.ftp), startDate: header.startDate,
      riderWeight: header.riderWeight)
  }

  public func replay() -> RideEngine {
    RideEngine(replaying: inputs, from: freshSession())
  }

  public init?(jsonLines data: Data) {
    let decoder = JSONDecoder()
    var lines = data.split(separator: Self.newline).makeIterator()
    guard let first = lines.next(), let header = try? decoder.decode(Header.self, from: first)
    else { return nil }
    self.init(
      header: header, inputs: lines.compactMap { try? decoder.decode(RideInput.self, from: $0) })
  }

  public func jsonLines() throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    return try ([encoder.encode(header)] + inputs.map(encoder.encode)).reduce(into: Data()) {
      $0 += $1 + [Self.newline]
    }
  }

  static let newline = UInt8(ascii: "\n")
}
