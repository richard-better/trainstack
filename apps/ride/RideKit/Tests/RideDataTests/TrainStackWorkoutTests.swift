import Foundation
import Testing

@testable import RideData

struct TrainStackWorkoutTests {
  struct Case: Decodable {
    let name: String
    let workout: TrainStackWorkout
  }

  static let folder = URL(filePath: #filePath).deletingLastPathComponent().appending(
    path: "Workouts")

  static func cases() throws -> [Case] {
    try JSONDecoder().decode(
      [Case].self, from: Data(contentsOf: folder.appending(path: "workouts.json")))
  }

  static func workout(named name: String) throws -> TrainStackWorkout {
    try #require(try cases().first { $0.name == name }).workout
  }

  @Test func playsEveryStepAsTheServerFlattensIt() throws {
    let document = try Self.played(try Self.cases())
    let url = Self.folder.appending(path: "played.json")
    if ProcessInfo.processInfo.environment["RIDE_RECORD_WORKOUTS"] == "1" {
      try document.write(to: url)
    }
    let recorded = try Data(contentsOf: url)
    #expect(
      String(decoding: recorded, as: UTF8.self) == String(decoding: document, as: UTF8.self),
      "Ride no longer plays Workouts/workouts.json as Workouts/played.json says, which tests/ride-workouts.test.mjs holds to @trainstack/workout's flatten. Record with RIDE_RECORD_WORKOUTS=1."
    )
  }

  @Test func playsNestedRepeatsStepByStepWithEachRepeatCueOnItsStep() throws {
    let workout = try Self.workout(
      named: "Nested repeats with ramps, ranges, watts, cadence and cues")
    let planned = try #require(workout.rideability.planned)
    #expect(planned.name == "Over-unders with sprints")
    #expect(planned.category == .threshold)
    #expect(planned.steps.count == 1 + 3 * 6 + 1)
    #expect(planned.duration == 600 + 3 * 540 + 300)
    #expect(planned.steps[0].target == .shareOfFTP(.ramp(from: 0.5, to: 0.75)))
    #expect(planned.steps[0].cadence == .range(low: 85, high: 95))
    #expect(planned.steps[1].name == "Over")
    #expect(
      planned.steps[1].cues == [
        PlannedCue(at: 0, text: "Here we go"), PlannedCue(at: 10, text: "Settle in"),
      ])
    #expect(planned.steps[2].target == .watts(.constant(400)))
    #expect(planned.steps[3].target == nil)
    #expect(planned.steps[3].cues == [PlannedCue(at: 0, text: "Sprint now", shownFor: 5)])
    #expect(planned.steps[6].target == .shareOfFTP(.range(low: 0.55, high: 0.65)))
    #expect(planned.steps[7].cues.map(\.text) == ["Settle in"])
    #expect(planned.steps[9].cues.isEmpty)
  }

  @Test func playsHeartRateAndMaxEffortTargetsAsWritten() throws {
    let planned = try #require(
      try Self.workout(named: "Heart rate, max effort and watts ramps").rideability.planned)
    #expect(
      planned.steps.map(\.target) == [
        .beatsPerMinute(.range(low: 130, high: 140)), .shareOfThresholdHeartRate(.constant(0.85)),
        .maxEffort, .watts(.ramp(from: 200, to: 300)),
      ])
    #expect(planned.category == nil)
  }

  @Test func saysWhyAWorkoutCannotBeRidden() throws {
    #expect(
      try Self.workout(named: "A running workout").rideability == .unrideable(.sport(.running)))
    #expect(
      try Self.workout(named: "A cycling workout with a pace target").rideability
        == .unrideable(.paceTargets))
    #expect(
      try Self.workout(named: "A cycling workout with a distance step").rideability
        == .unrideable(.distanceSteps))
  }

  @Test func refusesAUnitItDoesNotKnowRatherThanGuessing() throws {
    let json = """
      {"name":"Future","sport":"cycling","steps":[{"type":"step","duration":{"type":"time","seconds":60},
      "target":{"type":"power","unit":"kilowatts","level":{"kind":"constant","value":0.2}}}]}
      """
    let workout = try JSONDecoder().decode(TrainStackWorkout.self, from: Data(json.utf8))
    #expect(workout.rideability == .unrideable(.unknownUnit("kilowatts")))
  }

  private static func workout(steps: String, sport: String = "cycling") throws
    -> TrainStackWorkout
  {
    let json = #"{"name":"Future","sport":"\#(sport)","steps":[\#(steps)]}"#
    return try JSONDecoder().decode(TrainStackWorkout.self, from: Data(json.utf8))
  }

  @Test(arguments: [
    (
      #"{"type":"step","duration":{"type":"time","seconds":60},"target":{"type":"lactate","unit":"mmol","level":{"kind":"constant","value":2}}}"#,
      UnrideableReason.unknownKind(of: "target", named: "lactate")
    ),
    (
      #"{"type":"step","duration":{"type":"strokes","count":20}}"#,
      .unknownKind(of: "duration", named: "strokes")
    ),
    (
      #"{"type":"step","duration":{"type":"time","seconds":60},"target":{"type":"power","unit":"ftp","level":{"kind":"wave","value":1}}}"#,
      .unknownKind(of: "level", named: "wave")
    ),
    (
      #"{"type":"superset","steps":[]}"#, .unknownKind(of: "block", named: "superset")
    ),
    (
      #"{"type":"repeat","count":2,"steps":[{"type":"step","duration":{"type":"time","seconds":60},"cues":[{"at":{"type":"heartbeats","count":3},"text":"Go"}]}]}"#,
      .unknownKind(of: "cue offset", named: "heartbeats")
    ),
  ])
  func refusesByNameWhatItDoesNotKnowRatherThanFailing(
    step: String, reason: UnrideableReason
  ) throws {
    #expect(try Self.workout(steps: step).rideability == .unrideable(reason))
  }

  @Test(arguments: [
    (
      #"{"type":"step","duration":{"type":"time","seconds":60},"target":{"type":"power","unit":"watts","level":{"kind":"constant","value":1e300}}}"#,
      UnrideableReason.targetOutOfReach
    ),
    (
      #"{"type":"step","duration":{"type":"time","seconds":60},"target":{"type":"power","unit":"ftp","level":{"kind":"ramp","from":0.5,"to":40}}}"#,
      .targetOutOfReach
    ),
    (
      #"{"type":"step","duration":{"type":"time","seconds":60},"target":{"type":"power","unit":"ftp","level":{"kind":"range","low":1.1,"high":0.9}}}"#,
      .targetOutOfReach
    ),
    (
      #"{"type":"step","duration":{"type":"time","seconds":60},"cadence":{"kind":"constant","value":1e12}}"#,
      .targetOutOfReach
    ),
    (
      #"{"type":"step","duration":{"type":"time","seconds":1e300}}"#, .stepTooLong
    ),
    (
      #"{"type":"step","duration":{"type":"time","seconds":-30}}"#, .stepWithoutLength
    ),
    (
      #"{"type":"step","duration":{"type":"time","seconds":0}}"#, .stepWithoutLength
    ),
    (
      #"{"type":"repeat","count":2,"cues":[{"at":{"type":"distance","meters":100},"text":"Go"}],"steps":[{"type":"step","duration":{"type":"time","seconds":60}}]}"#,
      .distanceSteps
    ),
    (
      #"{"type":"repeat","count":9223372036854775807,"steps":[{"type":"repeat","count":4,"steps":[{"type":"step","duration":{"type":"time","seconds":1}}]}]}"#,
      .tooManySteps
    ),
  ])
  func refusesWhatWouldCrashOrSilentlyChangeTheRide(step: String, reason: UnrideableReason) throws {
    #expect(try Self.workout(steps: step).rideability == .unrideable(reason))
  }

  @Test(arguments: [
    #"{"type":"repeat","count":9223372036854775807,"steps":[{"type":"repeat","count":0,"steps":[{"type":"step","duration":{"type":"time","seconds":1}}]}]}"#,
    #"{"type":"repeat","count":0,"steps":[{"type":"repeat","count":9223372036854775807,"steps":[{"type":"repeat","count":9223372036854775807,"steps":[{"type":"step","duration":{"type":"time","seconds":1}}]}]}]}"#,
  ])
  func expandsARepeatThatComesToNothingWithoutAllocatingIt(steps: String) throws {
    let workout = try Self.workout(
      steps: steps + #",{"type":"step","duration":{"type":"time","seconds":60}}"#)
    #expect(workout.flattened.count == 1)
    #expect(workout.rideability.planned?.duration == 60)
  }

  @Test func refusesALapButtonStepUntilThePlayerCanPlayOne() throws {
    let open = try Self.workout(
      steps: #"""
        {"type":"repeat","count":2,"steps":[{"type":"step","duration":{"type":"open","expected":{"type":"time","seconds":600}},"target":{"type":"power","unit":"ftp","level":{"kind":"constant","value":0.9}}}]}
        """#)
    #expect(open.rideability == .unrideable(.lapButtonSteps))
    #expect(
      open.flattened.first?.duration == .untilLap(expected: .seconds(600)))
  }

  @Test func refusesASportItDoesNotKnowAsAnotherSport() throws {
    let rowing = try Self.workout(
      steps: #"{"type":"step","duration":{"type":"time","seconds":60}}"#, sport: "rowing")
    #expect(rowing.rideability == .unrideable(.sport(.init(rawValue: "rowing"))))
  }

  @Test func encodesTheWorkoutBackAsItCame() throws {
    for item in try Self.cases() {
      let again = try JSONDecoder().decode(
        TrainStackWorkout.self, from: JSONEncoder().encode(item.workout))
      #expect(again == item.workout)
    }
  }

  private struct Played: Encodable {
    let name: String
    let reason: String?
    let steps: [TrainStackWorkout.Block]
  }

  private static func played(_ cases: [Case]) throws -> Data {
    let played = cases.map { item in
      switch item.workout.rideability {
      case .rideable(let planned):
        Played(name: item.name, reason: nil, steps: planned.steps.map(\.asServerStep))
      case .unrideable(let reason):
        Played(name: item.name, reason: reason.explanation, steps: [])
      }
    }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(played) + Data("\n".utf8)
  }
}

extension PlannedStep {
  fileprivate var asServerStep: TrainStackWorkout.Block {
    .step(
      TrainStackWorkout.Step(
        duration: .seconds(duration), target: target?.asServerTarget,
        cadence: cadence?.asServerLevel, name: name, notes: notes,
        cues: cues.map { .init(at: .seconds($0.at), text: $0.text, shownForSeconds: $0.shownFor) }))
  }
}

extension PlannedTarget {
  fileprivate var asServerTarget: TrainStackWorkout.Target {
    switch self {
    case .shareOfFTP(let level): .power(unit: "ftp", level: level.asServerLevel)
    case .watts(let level): .power(unit: "watts", level: level.asServerLevel)
    case .shareOfThresholdHeartRate(let level):
      .heartRate(unit: "threshold", level: level.asServerLevel)
    case .beatsPerMinute(let level): .heartRate(unit: "bpm", level: level.asServerLevel)
    case .maxEffort: .maxEffort
    }
  }
}

extension TargetLevel {
  fileprivate var asServerLevel: TrainStackWorkout.Level {
    switch self {
    case .constant(let value): .constant(value)
    case .range(let low, let high): .range(low: low, high: high)
    case .ramp(let from, let to): .ramp(from: from, to: to)
    }
  }
}
