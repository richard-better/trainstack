import Foundation

private enum Field: String, CodingKey {
  case type, seconds, meters, kind, value, low, high, from, to, unit, level, at, text
  case shownForSeconds, duration, target, cadence, intensity, name, notes, cues, count, steps
  case expected
}

extension TrainStackWorkout.Amount: Codable {
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: Field.self)
    switch try container.decode(String.self, forKey: .type) {
    case "time": self = .seconds(try container.decode(Double.self, forKey: .seconds))
    case "distance": self = .meters(try container.decode(Double.self, forKey: .meters))
    case "open":
      self = .untilLap(
        expected: try container.decodeIfPresent(TrainStackWorkout.Amount.self, forKey: .expected))
    case let type: self = .unknown(type)
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Field.self)
    switch self {
    case .seconds(let seconds):
      try container.encode("time", forKey: .type)
      try container.encode(seconds, forKey: .seconds)
    case .meters(let meters):
      try container.encode("distance", forKey: .type)
      try container.encode(meters, forKey: .meters)
    case .untilLap(let expected):
      try container.encode("open", forKey: .type)
      try container.encodeIfPresent(expected, forKey: .expected)
    case .unknown(let type):
      try container.encode(type, forKey: .type)
    }
  }
}

extension TrainStackWorkout.Level: Codable {
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: Field.self)
    switch try container.decode(String.self, forKey: .kind) {
    case "constant": self = .constant(try container.decode(Double.self, forKey: .value))
    case "range":
      self = .range(
        low: try container.decode(Double.self, forKey: .low),
        high: try container.decode(Double.self, forKey: .high))
    case "ramp":
      self = .ramp(
        from: try container.decode(Double.self, forKey: .from),
        to: try container.decode(Double.self, forKey: .to))
    case let kind: self = .unknown(kind)
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Field.self)
    switch self {
    case .constant(let value):
      try container.encode("constant", forKey: .kind)
      try container.encode(value, forKey: .value)
    case .range(let low, let high):
      try container.encode("range", forKey: .kind)
      try container.encode(low, forKey: .low)
      try container.encode(high, forKey: .high)
    case .ramp(let from, let to):
      try container.encode("ramp", forKey: .kind)
      try container.encode(from, forKey: .from)
      try container.encode(to, forKey: .to)
    case .unknown(let kind):
      try container.encode(kind, forKey: .kind)
    }
  }
}

extension TrainStackWorkout.Target: Codable {
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: Field.self)
    let type = try container.decode(String.self, forKey: .type)
    guard ["power", "pace", "heartRate"].contains(type) else {
      self = type == "maxEffort" ? .maxEffort : .unknown(type)
      return
    }
    let unit = try container.decode(String.self, forKey: .unit)
    let level = try container.decode(TrainStackWorkout.Level.self, forKey: .level)
    switch type {
    case "power": self = .power(unit: unit, level: level)
    case "pace": self = .pace(unit: unit, level: level)
    default: self = .heartRate(unit: unit, level: level)
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Field.self)
    let (type, unit, level): (String, String?, TrainStackWorkout.Level?) =
      switch self {
      case .power(let unit, let level): ("power", unit, level)
      case .pace(let unit, let level): ("pace", unit, level)
      case .heartRate(let unit, let level): ("heartRate", unit, level)
      case .maxEffort: ("maxEffort", nil, nil)
      case .unknown(let type): (type, nil, nil)
      }
    try container.encode(type, forKey: .type)
    try container.encodeIfPresent(unit, forKey: .unit)
    try container.encodeIfPresent(level, forKey: .level)
  }
}

extension TrainStackWorkout.Cue: Codable {
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: Field.self)
    at = try container.decode(TrainStackWorkout.Amount.self, forKey: .at)
    text = try container.decode(String.self, forKey: .text)
    shownForSeconds = try container.decodeIfPresent(Double.self, forKey: .shownForSeconds)
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Field.self)
    try container.encode(at, forKey: .at)
    try container.encode(text, forKey: .text)
    try container.encodeIfPresent(shownForSeconds, forKey: .shownForSeconds)
  }
}

extension TrainStackWorkout.Block: Codable {
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: Field.self)
    let cues = try container.decodeIfPresent([TrainStackWorkout.Cue].self, forKey: .cues) ?? []
    let name = try container.decodeIfPresent(String.self, forKey: .name)
    switch try container.decode(String.self, forKey: .type) {
    case "step":
      self = .step(
        .init(
          duration: try container.decode(TrainStackWorkout.Amount.self, forKey: .duration),
          target: try container.decodeIfPresent(TrainStackWorkout.Target.self, forKey: .target),
          cadence: try container.decodeIfPresent(TrainStackWorkout.Level.self, forKey: .cadence),
          intensity: try container.decodeIfPresent(String.self, forKey: .intensity),
          name: name, notes: try container.decodeIfPresent(String.self, forKey: .notes),
          cues: cues))
    case "repeat":
      self = .repeat(
        .init(
          count: try container.decode(Int.self, forKey: .count),
          blocks: try container.decode([TrainStackWorkout.Block].self, forKey: .steps),
          name: name, cues: cues))
    case let type: self = .unknown(type)
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Field.self)
    switch self {
    case .step(let step):
      try container.encode("step", forKey: .type)
      try container.encode(step.duration, forKey: .duration)
      try container.encodeIfPresent(step.target, forKey: .target)
      try container.encodeIfPresent(step.cadence, forKey: .cadence)
      try container.encodeIfPresent(step.intensity, forKey: .intensity)
      try container.encodeIfPresent(step.name, forKey: .name)
      try container.encodeIfPresent(step.notes, forKey: .notes)
      if !step.cues.isEmpty { try container.encode(step.cues, forKey: .cues) }
    case .repeat(let block):
      try container.encode("repeat", forKey: .type)
      try container.encode(block.count, forKey: .count)
      try container.encode(block.blocks, forKey: .steps)
      try container.encodeIfPresent(block.name, forKey: .name)
      if !block.cues.isEmpty { try container.encode(block.cues, forKey: .cues) }
    case .unknown(let type):
      try container.encode(type, forKey: .type)
    }
  }
}
