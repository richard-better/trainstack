import Foundation

extension TrainStackWorkout {
  public var rideability: Rideability {
    guard sport == .cycling else { return .unrideable(.sport(sport)) }
    if let unknown = Self.firstUnknown(in: blocks) { return .unrideable(unknown) }
    guard Self.expandedLength(of: blocks) <= Self.mostSteps else {
      return .unrideable(.tooManySteps)
    }
    let steps = flattened
    if steps.contains(where: \.hasPaceTarget) { return .unrideable(.paceTargets) }
    if steps.contains(where: \.isMeasuredInDistance) { return .unrideable(.distanceSteps) }
    var planned: [PlannedStep] = []
    for step in steps {
      switch step.planned {
      case .success(let step): planned.append(step)
      case .failure(let reason): return .unrideable(reason)
      }
    }
    return .rideable(
      PlannedWorkout(
        name: name, category: focus.map(\.powerZone), about: description ?? "", steps: planned))
  }

  public var flattened: [Step] {
    Self.expandedLength(of: blocks) <= Self.mostSteps ? Self.expand(blocks) : []
  }

  private static func firstUnknown(in blocks: [Block]) -> UnrideableReason? {
    for block in blocks {
      switch block {
      case .unknown(let type): return .unknownKind(of: "block", named: type)
      case .repeat(let block):
        if let unknown = block.cues.lazy.compactMap(\.at.unknownKind).first {
          return .unknownKind(of: "cue offset", named: unknown)
        }
        if block.cues.contains(where: { !$0.at.isTime }) { return .distanceSteps }
        if !block.cues.isEmpty, containsALapStep(block.blocks) {
          return .repeatCueAcrossALapStep
        }
        if let unknown = firstUnknown(in: block.blocks) { return unknown }
      case .step(let step):
        if let unknown = step.unknownPart { return unknown }
      }
    }
    return nil
  }

  public static let mostSteps = 10_000

  private static func expandedLength(of blocks: [Block]) -> Int {
    blocks.reduce(0) { total, block in
      let length: Int
      switch block {
      case .step: length = 1
      case .unknown: length = 0
      case .repeat(let block):
        let (product, overflow) = max(block.count, 0).multipliedReportingOverflow(
          by: expandedLength(of: block.blocks))
        length = overflow ? .max : product
      }
      let (sum, overflow) = total.addingReportingOverflow(length)
      return overflow ? .max : sum
    }
  }

  private static func containsALapStep(_ blocks: [Block]) -> Bool {
    blocks.contains { block in
      switch block {
      case .step(let step): step.lastsUntilLap
      case .repeat(let block): containsALapStep(block.blocks)
      case .unknown: false
      }
    }
  }

  private static func expand(_ blocks: [Block]) -> [Step] {
    blocks.flatMap { block -> [Step] in
      switch block {
      case .unknown: return []
      case .step(let step): return [step]
      case .repeat(let block):
        guard block.count > 0 else { return [] }
        let once = expand(block.blocks)
        guard !once.isEmpty else { return [] }
        let expanded = Array(repeating: once, count: block.count).flatMap(\.self)
        return block.cues.reduce(expanded) { placing($1, in: $0) }
      }
    }
  }

  private static func placing(_ cue: Cue, in steps: [Step]) -> [Step] {
    guard case .seconds(let offset) = cue.at else { return steps }
    var start: Double = 0
    for (index, step) in steps.enumerated() {
      guard case .seconds(let length) = step.duration else { return steps }
      let end = start + length
      if offset < end || (index == steps.count - 1 && offset == end) {
        var steps = steps
        var placed = cue
        placed.at = .seconds(offset - start)
        steps[index].cues = (step.cues + [placed]).sorted { $0.at.amount < $1.at.amount }
        return steps
      }
      start = end
    }
    return steps
  }
}

extension TrainStackWorkout.Amount {
  fileprivate var amount: Double {
    switch self {
    case .seconds(let seconds): seconds
    case .meters(let meters): meters
    case .untilLap, .unknown: 0
    }
  }

  fileprivate var isTime: Bool {
    guard case .seconds = self else { return false }
    return true
  }

  fileprivate var unknownKind: String? {
    switch self {
    case .unknown(let kind): kind
    case .untilLap(let expected?): expected.unknownKind
    case .seconds, .meters, .untilLap(nil): nil
    }
  }
}

extension TrainStackWorkout.Focus {
  public var powerZone: PowerZone {
    switch self {
    case .recovery: .recovery
    case .endurance: .endurance
    case .tempo: .tempo
    case .threshold: .threshold
    case .vo2Max: .vo2Max
    case .anaerobic: .anaerobic
    }
  }
}

extension TrainStackWorkout.Level {
  fileprivate var targetLevel: TargetLevel {
    switch self {
    case .constant(let value): .constant(value)
    case .range(let low, let high): .range(low: low, high: high)
    case .ramp(let from, let to): .ramp(from: from, to: to)
    case .unknown: .constant(0)
    }
  }

  fileprivate var unknownKind: String? {
    guard case .unknown(let kind) = self else { return nil }
    return kind
  }
}

extension TrainStackWorkout.Step {
  fileprivate var unknownPart: UnrideableReason? {
    if let kind = duration.unknownKind { return .unknownKind(of: "duration", named: kind) }
    if let kind = cues.lazy.compactMap(\.at.unknownKind).first {
      return .unknownKind(of: "cue offset", named: kind)
    }
    switch target {
    case .unknown(let type): return .unknownKind(of: "target", named: type)
    case .power(_, let level), .pace(_, let level), .heartRate(_, let level):
      if let kind = level.unknownKind { return .unknownKind(of: "level", named: kind) }
    case .maxEffort, nil: break
    }
    if let kind = cadence?.unknownKind { return .unknownKind(of: "cadence", named: kind) }
    return nil
  }

  fileprivate var lastsUntilLap: Bool {
    guard case .untilLap = duration else { return false }
    return true
  }

  fileprivate var hasPaceTarget: Bool {
    guard case .pace = target else { return false }
    return true
  }

  fileprivate var isMeasuredInDistance: Bool {
    switch duration {
    case .seconds, .untilLap: break
    case .meters, .unknown: return true
    }
    return cues.contains {
      guard case .seconds = $0.at else { return true }
      return false
    }
  }

  fileprivate var planned: Result<PlannedStep, UnrideableReason> {
    let seconds: TimeInterval
    var untilLap: UntilLap?
    switch duration {
    case .seconds(let length):
      guard length > 0 else { return .failure(.stepWithoutLength) }
      guard length <= PlannedStep.longest else { return .failure(.stepTooLong) }
      seconds = length
    case .untilLap(let expected):
      switch target {
      case .power(_, .ramp), .heartRate(_, .ramp), .pace(_, .ramp):
        return .failure(.rampOnALapStep)
      default: break
      }
      switch expected {
      case .seconds(let expected) where expected > 0 && expected <= PlannedStep.longest:
        untilLap = UntilLap(expectedSeconds: expected)
      case .meters(let expected) where expected > 0 && expected.isFinite:
        untilLap = UntilLap(expectedMeters: expected)
      default: untilLap = UntilLap()
      }
      seconds = 0
    case .meters, .unknown: return .failure(.distanceSteps)
    }
    let target: PlannedTarget?
    switch self.target {
    case nil: target = nil
    case .maxEffort: target = .maxEffort
    case .power("ftp", let level): target = .shareOfFTP(level.targetLevel)
    case .power("watts", let level): target = .watts(level.targetLevel)
    case .heartRate("threshold", let level): target = .shareOfThresholdHeartRate(level.targetLevel)
    case .heartRate("bpm", let level): target = .beatsPerMinute(level.targetLevel)
    case .pace: return .failure(.paceTargets)
    case .power(let unit, _), .heartRate(let unit, _): return .failure(.unknownUnit(unit))
    case .unknown(let type): return .failure(.unknownKind(of: "target", named: type))
    }
    if let target, !target.isWithinReach { return .failure(.targetOutOfReach) }
    if let cadence = cadence?.targetLevel, !cadence.isWithin(TargetLevel.mostCadence) {
      return .failure(.targetOutOfReach)
    }
    return .success(
      PlannedStep(
        duration: seconds, target: target, cadence: cadence?.targetLevel, name: name,
        notes: notes,
        cues: cues.compactMap { cue in
          guard case .seconds(let at) = cue.at else { return nil }
          return PlannedCue(at: at, text: cue.text, shownFor: cue.shownForSeconds)
        }, untilLap: untilLap))
  }
}

extension PlannedTarget {
  fileprivate var isWithinReach: Bool {
    switch self {
    case .shareOfFTP(let level): level.isWithin(TargetLevel.mostShareOfFTP)
    case .watts(let level): level.isWithin(TargetLevel.mostWatts)
    case .shareOfThresholdHeartRate(let level):
      level.isWithin(TargetLevel.mostShareOfThresholdHeartRate)
    case .beatsPerMinute(let level): level.isWithin(TargetLevel.mostBeatsPerMinute)
    case .maxEffort: true
    }
  }
}

extension TargetLevel {
  static let mostShareOfFTP = 10.0
  static let mostWatts = 5000.0
  static let mostShareOfThresholdHeartRate = 3.0
  static let mostBeatsPerMinute = 300.0
  static let mostCadence = 300.0

  fileprivate func isWithin(_ most: Double) -> Bool {
    let values: [Double] =
      switch self {
      case .constant(let value): [value]
      case .range(let low, let high): low <= high ? [low, high] : [.nan]
      case .ramp(let from, let to): [from, to]
      }
    return values.allSatisfy { $0.isFinite && $0 >= 0 && $0 <= most }
  }
}

extension PlannedStep {
  public static let longest: TimeInterval = 24 * 60 * 60
}
