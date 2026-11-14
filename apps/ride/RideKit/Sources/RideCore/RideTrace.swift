import Foundation
import RideData

public struct RideTrace: Equatable, Sendable {
  public struct Header: Equatable, Codable, Sendable {
    public var workout: PlannedWorkout
    public var ftp: Int
    public var startDate: Date
    public var utcOffsetSeconds: Int?
    public var riderWeight: Double

    public init(
      workout: PlannedWorkout, ftp: Int, startDate: Date, utcOffsetSeconds: Int? = nil,
      riderWeight: Double
    ) {
      self.workout = workout
      self.ftp = ftp
      self.startDate = startDate
      self.utcOffsetSeconds = utcOffsetSeconds
      self.riderWeight = riderWeight
    }

    public init(template: WorkoutTemplate, ftp: Int, startDate: Date, riderWeight: Double) {
      self.init(workout: template.planned, ftp: ftp, startDate: startDate, riderWeight: riderWeight)
    }

    private enum CodingKeys: String, CodingKey {
      case workout, template, ftp, startDate, utcOffsetSeconds, riderWeight
    }

    public init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      workout =
        try container.decodeIfPresent(PlannedWorkout.self, forKey: .workout)
        ?? container.decode(WorkoutTemplate.self, forKey: .template).planned
      ftp = try container.decode(Int.self, forKey: .ftp)
      startDate = try container.decode(Date.self, forKey: .startDate)
      utcOffsetSeconds = try container.decodeIfPresent(Int.self, forKey: .utcOffsetSeconds)
      riderWeight = try container.decode(Double.self, forKey: .riderWeight)
    }

    public func encode(to encoder: any Encoder) throws {
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(workout, forKey: .workout)
      try container.encode(ftp, forKey: .ftp)
      try container.encode(startDate, forKey: .startDate)
      try container.encodeIfPresent(utcOffsetSeconds, forKey: .utcOffsetSeconds)
      try container.encode(riderWeight, forKey: .riderWeight)
    }
  }

  public var header: Header
  public var inputs: [RideInput]

  public init(header: Header, inputs: [RideInput] = []) {
    self.header = header
    self.inputs = inputs
  }

  public var name: String { header.workout.name }

  public func freshSession() -> RideSession {
    RideSession(
      workout: header.workout.workout(ftp: header.ftp), startDate: header.startDate,
      utcOffsetSeconds: header.utcOffsetSeconds, riderWeight: header.riderWeight)
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
