import Foundation

/// A workout written against FTP rather than in watts, so one template suits every rider.
public struct WorkoutTemplate: Identifiable, Hashable, Sendable {
  public struct Step: Hashable, Sendable {
    public var duration: TimeInterval
    /// Target power as a fraction of FTP.
    public var intensity: Double

    public init(duration: TimeInterval, intensity: Double) {
      self.duration = duration
      self.intensity = intensity
    }

    public var zone: PowerZone { PowerZone.zone(intensity: intensity) }
  }

  public var name: String
  /// The zone the workout trains, used to label and filter it.
  public var category: PowerZone
  public var steps: [Step]
  /// What the workout asks of the rider and what it is good for, in a sentence or two.
  public var about: String

  public var id: String { name }

  public init(name: String, category: PowerZone, steps: [Step], about: String = "") {
    self.name = name
    self.category = category
    self.steps = steps
    self.about = about
  }

  public var duration: TimeInterval { steps.reduce(0) { $0 + $1.duration } }

  /// Training stress score if ridden exactly as written: 100 for an hour at FTP.
  public var stressScore: Int {
    Int((steps.reduce(0) { $0 + $1.duration * $1.intensity * $1.intensity } / 36).rounded())
  }

  /// The workout in watts for a rider with this FTP.
  public func workout(ftp: Int) -> Workout {
    Workout(
      name: name,
      steps: steps.map {
        .init(duration: $0.duration, targetPower: Int((Double(ftp) * $0.intensity).rounded()))
      })
  }

  /// The same workout lasting `duration`. The easy steps stretch or shrink so the hard efforts
  /// keep their length; only when the hard efforts alone do not fit does every step shrink.
  public func fitted(to duration: TimeInterval) -> WorkoutTemplate {
    let isEasy = { (step: Step) in step.intensity < Self.easyIntensity }
    let easy = steps.filter(isEasy).reduce(0) { $0 + $1.duration }
    let hard = self.duration - easy
    let fitsHard = easy > 0 && hard < duration
    let scale =
      fitsHard ? (duration - hard) / easy : duration / max(self.duration, 1)
    var result = self
    result.steps = steps.compactMap { step in
      let stretches = !fitsHard || isEasy(step)
      let length = stretches ? (step.duration * scale).rounded() : step.duration
      return length > 0 ? Step(duration: length, intensity: step.intensity) : nil
    }
    // Rounding each step can leave a few seconds over or under; settle them on the longest step.
    if let longest = result.steps.indices.max(by: {
      result.steps[$0].duration < result.steps[$1].duration
    }) {
      result.steps[longest].duration += duration - result.duration
    }
    // "Recovery 30" fitted to 45 minutes becomes "Recovery 45".
    let suffix = " \(Int((self.duration / 60).rounded()))"
    if name.hasSuffix(suffix) {
      result.name = name.dropLast(suffix.count) + " \(Int((duration / 60).rounded()))"
    }
    return result
  }

  /// Steps below this share of FTP are recovery and endurance, which can stretch or shrink.
  public static let easyIntensity = 0.75
}

extension WorkoutTemplate {
  /// The workouts that ship with the app.
  public static let library: [WorkoutTemplate] = [
    .init(
      name: "Zone 3 · 3×10", category: .tempo,
      steps: minutes(
        [(6, 50), (4, 65)] + repeated(3, [(10, 85), (4, 50)]).dropLast() + [(6, 50)]),
      about:
        "Three 10-minute blocks at tempo with easy spinning between. Steady, honest work that builds aerobic strength without draining you."
    ),
    .init(
      name: "Threshold waves 3×12", category: .threshold,
      steps: minutes([(6, 50), (3, 70), (12, 96), (4, 50), (12, 99), (4, 50), (12, 102), (7, 50)]),
      about:
        "Three 12-minute blocks that creep from just under threshold to just over it. Stretches how long you can hold your FTP."
    ),
    .init(
      name: "Ramp openers 30", category: .vo2Max,
      steps: minutes(
        [
          (6, 50), (3, 68), (2, 80), (2, 50), (2, 90), (2, 50), (1, 105), (2, 50), (1, 115),
          (2, 50),
          (1, 125), (2, 50), (1, 130), (3, 50),
        ]),
      about:
        "Short efforts that climb from tempo to well over threshold, with easy spinning between. Wakes the legs up before a race or a hard day."
    ),
    .init(
      name: "Over-unders 2×10", category: .threshold,
      steps: minutes(
        [(8, 50), (10, 72)] + repeated(3, [(2, 104), (3, 72)]) + [(5, 72)]
          + repeated(3, [(2, 104), (3, 72)]) + [(8, 72), (5, 50)]),
      about:
        "Two sets of surges just over threshold that settle back to tempo rather than resting. Teaches you to recover while still working."
    ),
    .init(
      name: "Long endurance 90", category: .endurance,
      steps: minutes([(10, 50), (75, 68), (5, 50)]),
      about:
        "Over an hour of steady endurance riding. Builds the aerobic base everything else rests on."
    ),
    .init(
      name: "VO2 max booster", category: .vo2Max,
      steps: minutes(
        [(5, 40), (3, 50), (3, 58), (3, 64), (6, 72), (5, 52), (6, 125), (25, 68), (4, 45)]),
      about:
        "A ramping warm-up, one six-minute effort well above threshold, then a long endurance spin. Raises the ceiling on your aerobic power."
    ),
    .init(
      name: "Tabata 4×40/20", category: .anaerobic,
      steps: minutes(
        [(8, 50), (10, 68), (1, 130), (5, 50)] + repeated(4, [(2.0 / 3, 170), (1.0 / 3, 40)])
          + [(5, 50)]),
      about:
        "Four all-out 40-second sprints with 20 seconds' rest between them. Short, brutal and over quickly."
    ),
    .init(
      name: "Recovery 30", category: .endurance,
      steps: minutes(
        [(3, 50), (3, 58), (3, 62), (3, 66), (6, 72), (3, 66), (3, 62), (3, 58), (3, 50)]),
      about:
        "Gentle spinning that rises a little in the middle and eases off again. Keeps the legs turning on a rest day."
    ),
    .init(
      name: "Threshold classic 60", category: .threshold,
      steps: minutes(
        [(5, 45), (3, 55), (3, 65), (3, 72)]
          + repeated(3, [(10, 95), (1, 112), (5, 60)]).dropLast()
          + [(3, 50)]),
      about:
        "Three 10-minute blocks just under threshold, each finished with a one-minute push over it. A good benchmark for whether your FTP still feels right."
    ),
    .init(
      name: "Pixel sprints 30", category: .endurance,
      steps: minutes([(4, 55), (3, 66)] + repeated(8, [(2, 70), (0.5, 98)]) + [(3, 55)]),
      about:
        "Eight short surges over an endurance base. Playful enough to pass the time, easy enough to recover from."
    ),
    .init(
      name: "Quick test 45s", category: .vo2Max,
      steps: minutes([(0.25, 50), (0.25, 75), (0.25, 120)]),
      about:
        "Fifteen seconds each at easy, medium and hard. Too short to train anything; it is here to check a trainer and the ride from start to finish."
    ),
  ]

  public static func named(_ name: String) -> WorkoutTemplate? {
    library.first { $0.name == name }
  }

  /// Steps from (minutes, percent of FTP) pairs.
  private static func minutes(_ steps: [(Double, Double)]) -> [Step] {
    steps.map { Step(duration: ($0.0 * 60).rounded(), intensity: $0.1 / 100) }
  }

  private static func repeated(_ count: Int, _ steps: [(Double, Double)]) -> [(Double, Double)] {
    Array((0..<count).map { _ in steps }.joined())
  }
}
