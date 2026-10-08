import Foundation

/// A part of a workout as a rider reads it: the warm-up as one ramp, a set of repeated
/// intervals once with how many times it repeats, and the cool-down as one ramp.
public struct WorkoutSection: Equatable, Sendable {
  public enum Kind: Equatable, Sendable {
    case warmUp
    /// A step that stands on its own.
    case effort
    /// An easy step between harder ones.
    case recovery
    /// The steps ridden `count` times in a row.
    case repeats(Int)
    case coolDown
  }

  public var kind: Kind
  /// For repeats, the steps of one repeat. Otherwise every step in the section.
  public var steps: [WorkoutTemplate.Step]
  /// How many steps at the end of a repeat the last repeat leaves out, such as the recovery
  /// after the final interval.
  public var skippedInLastRepeat = 0

  public init(kind: Kind, steps: [WorkoutTemplate.Step], skippedInLastRepeat: Int = 0) {
    self.kind = kind
    self.steps = steps
    self.skippedInLastRepeat = skippedInLastRepeat
  }

  /// How long the section lasts, counting every repeat.
  public var duration: TimeInterval {
    let once = steps.reduce(0) { $0 + $1.duration }
    guard case .repeats(let count) = kind else { return once }
    let skipped = steps.suffix(skippedInLastRepeat).reduce(0) { $0 + $1.duration }
    return once * Double(count) - skipped
  }
}

extension WorkoutTemplate {
  /// The workout as sections, in order. Leading and trailing easy steps that do not repeat
  /// become the warm-up and cool-down, unless the whole workout is easy.
  public var sections: [WorkoutSection] {
    var sections: [WorkoutSection] = []
    var index = 0
    while index < steps.count {
      if let (section, length) = repeats(at: index) {
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

  /// The longest run of steps from `start` that repeats at least twice in full, and how many
  /// steps it covers. One more repeat after those may leave out steps at its end.
  private func repeats(at start: Int) -> (WorkoutSection, Int)? {
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
      // A last repeat cut short: the longest start of the block that follows the full repeats.
      let next = start + count * size
      let skipped =
        (1..<size).first { skip in
          let kept = size - skip
          return next + kept <= steps.count
            && steps[next..<(next + kept)] == block.prefix(kept)
        } ?? 0
      let total = count + (skipped > 0 ? 1 : 0)
      let length = count * size + (skipped > 0 ? size - skipped : 0)
      guard count >= 2, length > (best?.length ?? 0) else { continue }
      best = (
        WorkoutSection(kind: .repeats(total), steps: Array(block), skippedInLastRepeat: skipped),
        length
      )
    }
    return best.map { ($0.section, $0.length) }
  }
}
