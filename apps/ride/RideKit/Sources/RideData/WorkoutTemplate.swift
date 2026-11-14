import Foundation

public struct WorkoutTemplate: Identifiable, Hashable, Codable, Sendable {
  public struct Step: Hashable, Codable, Sendable {
    public var duration: TimeInterval
    public var intensity: Double

    public init(duration: TimeInterval, intensity: Double) {
      self.duration = duration
      self.intensity = intensity
    }

    public var zone: PowerZone { PowerZone.zone(intensity: intensity) }
  }

  public var name: String
  public var category: PowerZone
  public var steps: [Step]
  public var about: String
  public var cues: [TemplateCue]

  public var id: String { name }

  public init(
    name: String, category: PowerZone, steps: [Step], about: String = "",
    cues: [TemplateCue] = []
  ) {
    self.name = name
    self.category = category
    self.steps = steps
    self.about = about
    self.cues = cues
  }

  private enum CodingKeys: String, CodingKey {
    case name, category, steps, about, cues
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    name = try container.decode(String.self, forKey: .name)
    category = try container.decode(PowerZone.self, forKey: .category)
    steps = try container.decode([Step].self, forKey: .steps)
    about = try container.decode(String.self, forKey: .about)
    cues = try container.decodeIfPresent([TemplateCue].self, forKey: .cues) ?? []
  }

  public func cues(onStep index: Int) -> [PlannedCue] {
    cues.filter { $0.step == index }.map { PlannedCue(at: $0.at, text: $0.text) }
  }

  public var duration: TimeInterval { steps.reduce(0) { $0 + $1.duration } }

  public var stressScore: Int {
    let secondsInAnHour = 3600.0
    let hoursAtFTP =
      steps.reduce(0) { $0 + $1.duration * $1.intensity * $1.intensity } / secondsInAnHour
    return Int((hoursAtFTP * 100).rounded())
  }

  public func workout(ftp: Int) -> Workout {
    planned.workout(ftp: ftp)
  }

  public func fitted(to duration: TimeInterval) -> WorkoutTemplate {
    let isEasy = { (step: Step) in step.intensity < Self.easyIntensity }
    let easy = steps.filter(isEasy).reduce(0) { $0 + $1.duration }
    let hard = self.duration - easy
    let fitsHard = easy > 0 && hard < duration
    let scale =
      fitsHard ? (duration - hard) / easy : duration / max(self.duration, 1)
    var result = self
    let fitted = steps.enumerated().compactMap { index, step -> (index: Int, step: Step)? in
      let stretches = !fitsHard || isEasy(step)
      let length = stretches ? (step.duration * scale).rounded() : step.duration
      return length > 0 ? (index, Step(duration: length, intensity: step.intensity)) : nil
    }
    result.steps = fitted.map(\.step)
    if let longest = result.steps.indices.max(by: {
      result.steps[$0].duration < result.steps[$1].duration
    }) {
      let roundingLeftover = duration - result.duration
      result.steps[longest].duration += roundingLeftover
    }
    result.cues = fitted.enumerated().flatMap { newIndex, kept in
      cues.filter { $0.step == kept.index && $0.at < result.steps[newIndex].duration }.map {
        TemplateCue(step: newIndex, at: $0.at, text: $0.text)
      }
    }
    let suffix = " \(Int((self.duration / 60).rounded()))"
    if name.hasSuffix(suffix) {
      result.name = name.dropLast(suffix.count) + " \(Int((duration / 60).rounded()))"
    }
    return result
  }

  public static let easyIntensity = PowerZone.tempo.lowestIntensity
}

extension WorkoutTemplate {
  public static let library: [WorkoutTemplate] = [
    .init(
      name: "Zone 3 · 3×10", category: .tempo,
      steps: minutes(
        [(6, 50), (4, 65)] + repeated(3, [(10, 85), (4, 50)]).dropLast() + [(6, 50)]),
      about:
        "Three 10-minute blocks at tempo with easy spinning between. Steady, honest work that builds aerobic strength without draining you.",
      cues: [
        .cue(0, "Easy spin to warm up"),
        .cue(2, "Block 1 of 3. Steady, you could still talk"),
        .cue(3, "Ease off and drink"),
        .cue(4, "Block 2 of 3. Same rhythm as the first"),
        .cue(5, "Ease off and drink"),
        .cue(6, "Last block. Hold it steady to the end"),
        .cue(7, "Done. Spin it out"),
      ]
    ),
    .init(
      name: "Threshold waves 3×12", category: .threshold,
      steps: minutes([(6, 50), (3, 70), (12, 96), (4, 50), (12, 99), (4, 50), (12, 102), (7, 50)]),
      about:
        "Three 12-minute blocks that creep from just under threshold to just over it. Stretches how long you can hold your FTP.",
      cues: [
        .cue(0, "Warm up easy"),
        .cue(1, "A little pressure to open the legs"),
        .cue(2, "Wave 1: just under threshold"),
        .cue(3, "Recover. Spin light"),
        .cue(4, "Wave 2: right at threshold"),
        .cue(5, "Recover. Spin light"),
        .cue(6, "Wave 3: just over. Hang on"),
        .cue(6, at: 360, "Six minutes left. Stay smooth"),
        .cue(7, "Cool down"),
      ]
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
        "Short efforts that climb from tempo to well over threshold, with easy spinning between. Wakes the legs up before a race or a hard day.",
      cues: [
        .cue(0, "Easy spin to warm up"),
        .cue(2, "First opener: tempo"),
        .cue(6, "Over threshold for a minute"),
        .cue(12, "Last and hardest. Smooth, not ragged"),
        .cue(13, "Cool down. Legs are ready"),
      ]
    ),
    .init(
      name: "Over-unders 2×10", category: .threshold,
      steps: minutes(
        [(8, 50), (10, 72)] + repeated(3, [(2, 104), (3, 72)]) + [(5, 72)]
          + repeated(3, [(2, 104), (3, 72)]) + [(8, 72), (5, 50)]),
      about:
        "Two sets of surges just over threshold that settle back to tempo rather than resting. Teaches you to recover while still working.",
      cues: [
        .cue(0, "Warm up"),
        .cue(1, "Settle into tempo"),
        .cue(2, "Over: lift just above threshold"),
        .cue(3, "Under: back to tempo, not to rest"),
        .cue(8, "Hold tempo between the sets"),
        .cue(9, "Set 2. Over again"),
        .cue(15, "Tempo to finish the work"),
        .cue(16, "Cool down"),
      ]
    ),
    .init(
      name: "Long endurance 90", category: .endurance,
      steps: minutes([(10, 50), (75, 68), (5, 50)]),
      about:
        "Over an hour of steady endurance riding. Builds the aerobic base everything else rests on.",
      cues: [
        .cue(0, "Warm up easy"),
        .cue(1, "Long and steady. Eat and drink every 20 minutes"),
        .cue(1, at: 2400, "Halfway. Keep the cadence up"),
        .cue(2, "Cool down"),
      ]
    ),
    .init(
      name: "VO2 max booster", category: .vo2Max,
      steps: minutes(
        [(5, 40), (3, 50), (3, 58), (3, 64), (6, 72), (5, 52), (6, 118), (25, 68), (4, 45)]),
      about:
        "A ramping warm-up, one six-minute effort well above threshold, then a long endurance spin. Raises the ceiling on your aerobic power.",
      cues: [
        .cue(0, "The warm-up starts easy and ramps"),
        .cue(4, "Warm-up tops out at tempo"),
        .cue(5, "Easy before the effort"),
        .cue(6, "Six minutes well over threshold. Pace it evenly"),
        .cue(6, at: 180, "Halfway. Breathe deep"),
        .cue(7, "Long endurance spin"),
        .cue(8, "Cool down"),
      ]
    ),
    .init(
      name: "Tabata 4×40/20", category: .anaerobic,
      steps: minutes(
        [(8, 50), (10, 68), (1, 130), (5, 50)] + repeated(4, [(2.0 / 3, 170), (1.0 / 3, 40)])
          + [(5, 50)]),
      about:
        "Four all-out 40-second sprints with 20 seconds' rest between them. Short, brutal and over quickly.",
      cues: [
        .cue(0, "Warm up"),
        .cue(2, "One-minute primer"),
        .cue(3, "Recover before the sprints"),
        .cue(4, "Sprint 1 of 4. All out"),
        .cue(6, "Sprint 2 of 4"),
        .cue(8, "Sprint 3 of 4"),
        .cue(10, "Last sprint. Empty the tank"),
        .cue(12, "Cool down"),
      ]
    ),
    .init(
      name: "Recovery 30", category: .endurance,
      steps: minutes(
        [(3, 50), (3, 58), (3, 62), (3, 66), (6, 72), (3, 66), (3, 62), (3, 58), (3, 50)]),
      about:
        "Gentle spinning that rises a little in the middle and eases off again. Keeps the legs turning on a rest day.",
      cues: [
        .cue(0, "Easy. No pressure on the pedals"),
        .cue(4, "The gentle peak. Still easy"),
        .cue(8, "Wind down"),
      ]
    ),
    .init(
      name: "Threshold classic 60", category: .threshold,
      steps: minutes(
        [(5, 45), (3, 55), (3, 65), (3, 72)]
          + repeated(3, [(10, 95), (1, 112), (5, 60)]).dropLast()
          + [(3, 50)]),
      about:
        "Three 10-minute blocks just under threshold, each finished with a one-minute push over it. A good benchmark for whether your FTP still feels right.",
      cues: [
        .cue(0, "Warm up"),
        .cue(4, "Block 1 of 3, just under threshold"),
        .cue(5, "Push over for one minute"),
        .cue(6, "Recover"),
        .cue(7, "Block 2 of 3"),
        .cue(8, "Push over for one minute"),
        .cue(9, "Recover"),
        .cue(10, "Last block"),
        .cue(11, "Final push"),
        .cue(12, "Cool down"),
      ]
    ),
    .init(
      name: "Pixel sprints 30", category: .endurance,
      steps: minutes([(4, 55), (3, 66)] + repeated(8, [(2, 70), (0.5, 98)]) + [(3, 55)]),
      about:
        "Eight short surges over an endurance base. Playful enough to pass the time, easy enough to recover from.",
      cues: [
        .cue(0, "Warm up"),
        .cue(3, "Surge 1 of 8. Quick and light"),
        .cue(17, "Last surge"),
        .cue(18, "Cool down"),
      ]
    ),
    .init(
      name: "Quick test 45s", category: .vo2Max,
      steps: minutes([(0.25, 50), (0.25, 75), (0.25, 120)]),
      about:
        "Fifteen seconds each at easy, medium and hard. Too short to train anything; it is here to check a trainer and the ride from start to finish.",
      cues: [
        .cue(0, "Easy"),
        .cue(1, "Medium"),
        .cue(2, "Hard"),
      ]
    ),
  ]

  public static func named(_ name: String) -> WorkoutTemplate? {
    library.first { $0.name == name }
  }

  private typealias MinutesAtPercentOfFTP = (minutes: Double, percentOfFTP: Double)

  private static func minutes(_ steps: [MinutesAtPercentOfFTP]) -> [Step] {
    steps.map { Step(duration: ($0.minutes * 60).rounded(), intensity: $0.percentOfFTP / 100) }
  }

  private static func repeated(_ count: Int, _ steps: [MinutesAtPercentOfFTP])
    -> [MinutesAtPercentOfFTP]
  {
    Array((0..<count).map { _ in steps }.joined())
  }
}
