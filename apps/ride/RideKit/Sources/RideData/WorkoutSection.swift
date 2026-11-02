import Foundation

public struct WorkoutSection: Equatable, Sendable {
  public enum Kind: Equatable, Sendable {
    case warmUp
    case effort
    case recovery
    case repeats(Int)
    case coolDown
  }

  public var kind: Kind
  public var steps: [WorkoutTemplate.Step]
  public var skippedInLastRepeat = 0

  public init(kind: Kind, steps: [WorkoutTemplate.Step], skippedInLastRepeat: Int = 0) {
    self.kind = kind
    self.steps = steps
    self.skippedInLastRepeat = skippedInLastRepeat
  }

  public var duration: TimeInterval {
    let once = steps.reduce(0) { $0 + $1.duration }
    guard case .repeats(let count) = kind else { return once }
    let skipped = steps.suffix(skippedInLastRepeat).reduce(0) { $0 + $1.duration }
    return once * Double(count) - skipped
  }
}

extension WorkoutTemplate {
  public var sections: [WorkoutSection] {
    var sections: [WorkoutSection] = []
    var index = 0
    while index < steps.count {
      if let (section, length) = longestRepeat(at: index) {
        sections.append(section)
        index += length
      } else {
        sections.append(WorkoutSection(kind: .effort, steps: [steps[index]]))
        index += 1
      }
    }
    let isEasy = { (section: WorkoutSection) in
      section.kind == .effort && section.steps[0].intensity < Self.easyIntensity
    }
    let warmUp = sections.prefix(while: isEasy).count
    guard warmUp < sections.count else { return sections }
    let coolDown = sections.reversed().prefix(while: isEasy).count
    let middle = sections[warmUp..<(sections.count - coolDown)].map { section in
      var section = section
      if isEasy(section) { section.kind = .recovery }
      return section
    }
    let ramp = { (kind: WorkoutSection.Kind, sections: ArraySlice<WorkoutSection>) in
      sections.isEmpty ? [] : [WorkoutSection(kind: kind, steps: sections.flatMap(\.steps))]
    }
    return ramp(.warmUp, sections.prefix(warmUp)) + middle
      + ramp(.coolDown, sections.suffix(coolDown))
  }

  private func longestRepeat(at start: Int) -> (WorkoutSection, Int)? {
    var best: (section: WorkoutSection, length: Int)?
    let remaining = steps.count - start
    guard remaining >= 2 else { return nil }
    for size in 1...(remaining / 2 + 1) where size < remaining {
      let block = steps[start..<(start + size)]
      var count = 1
      while start + (count + 1) * size <= steps.count,
        steps[(start + count * size)..<(start + (count + 1) * size)] == block
      {
        count += 1
      }
      let afterFullRepeats = start + count * size
      let skippedInCutShortLastRepeat =
        (1..<size).first { skip in
          let kept = size - skip
          return afterFullRepeats + kept <= steps.count
            && steps[afterFullRepeats..<(afterFullRepeats + kept)] == block.prefix(kept)
        } ?? 0
      let hasCutShortLastRepeat = skippedInCutShortLastRepeat > 0
      let total = count + (hasCutShortLastRepeat ? 1 : 0)
      let length =
        count * size + (hasCutShortLastRepeat ? size - skippedInCutShortLastRepeat : 0)
      guard count >= 2, length > (best?.length ?? 0) else { continue }
      best = (
        WorkoutSection(
          kind: .repeats(total), steps: Array(block),
          skippedInLastRepeat: skippedInCutShortLastRepeat),
        length
      )
    }
    return best.map { ($0.section, $0.length) }
  }
}
