import Foundation

public enum TargetLevel: Hashable, Codable, Sendable {
  case constant(Double)
  case range(low: Double, high: Double)
  case ramp(from: Double, to: Double)

  public func value(atShareOfStep share: Double) -> Double {
    switch self {
    case .constant(let value): value
    case .range(let low, let high): (low + high) / 2
    case .ramp(let from, let to): from + (to - from) * min(max(share, 0), 1)
    }
  }

  public var average: Double { value(atShareOfStep: 0.5) }

  public var lowest: Double {
    switch self {
    case .constant(let value): value
    case .range(let low, _): low
    case .ramp(let from, let to): min(from, to)
    }
  }

  public var highest: Double {
    switch self {
    case .constant(let value): value
    case .range(_, let high): high
    case .ramp(let from, let to): max(from, to)
    }
  }

  public func scaled(by factor: Double) -> TargetLevel {
    mapped { $0 * factor }
  }

  public func mapped(_ transform: (Double) -> Double) -> TargetLevel {
    switch self {
    case .constant(let value): .constant(transform(value))
    case .range(let low, let high): .range(low: transform(low), high: transform(high))
    case .ramp(let from, let to): .ramp(from: transform(from), to: transform(to))
    }
  }
}
