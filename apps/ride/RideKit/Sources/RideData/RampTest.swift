import Foundation

public struct RampTest: Equatable, Sendable {
  public static let name = "Ramp Test"
  public static let assumedFTP = 200
  public static let warmUp: [(seconds: TimeInterval, shareOfFTP: Double)] = [
    (180, 0.4), (120, 0.5),
  ]
  public static let firstStepShareOfFTP = 0.5
  public static let stepShareOfFTP = 0.06
  public static let stepSeconds: TimeInterval = 60
  public static let mostSteps = 30
  public static let coolDownSeconds: TimeInterval = 300
  public static let coolDownShareOfFTP = 0.4
  public static let bestMinuteShare = 0.75
  public static let endsBelowShareOfTarget = 0.8
  public static let endsAfterSecondsBelow: TimeInterval = 10

  public let ftp: Int
  public let firstStepWatts: Int
  public let stepWatts: Int

  public init(ftp: Int?) {
    let ftp = ftp ?? Self.assumedFTP
    self.ftp = ftp
    stepWatts = max(5, Int((Double(ftp) * Self.stepShareOfFTP).rounded()))
    firstStepWatts = Self.roundedToFive(Double(ftp) * Self.firstStepShareOfFTP)
  }

  public func watts(ofStep index: Int) -> Int { firstStepWatts + index * stepWatts }

  public var planned: PlannedWorkout {
    let warmUp = Self.warmUp.map { part in
      PlannedStep(
        duration: part.seconds,
        target: .watts(.constant(Double(Self.roundedToFive(Double(ftp) * part.shareOfFTP)))),
        name: "Warm-up")
    }
    let ramp = (0..<Self.mostSteps).map { index in
      PlannedStep(
        duration: Self.stepSeconds, target: .watts(.constant(Double(watts(ofStep: index)))),
        name: "Ramp",
        cues: index == 0
          ? [
            PlannedCue(
              at: 0, text: "Hold each step as long as you can. The test ends when you can't.")
          ]
          : [])
    }
    let coolDown = PlannedStep(
      duration: Self.coolDownSeconds,
      target: .watts(.constant(Double(Self.roundedToFive(Double(ftp) * Self.coolDownShareOfFTP)))),
      name: "Cool-down", cues: [PlannedCue(at: 0, text: "Well done. Spin easy to cool down.")])
    return PlannedWorkout(
      name: Self.name, category: .vo2Max,
      about:
        "A warm-up, then a step up of \(stepWatts) W every minute from \(firstStepWatts) W until you can't hold it, then a cool-down. Your FTP is 75% of your best minute.",
      steps: warmUp + ramp + [coolDown],
      rampSteps: warmUp.count..<(warmUp.count + ramp.count))
  }

  private static func roundedToFive(_ watts: Double) -> Int {
    Int((watts / 5).rounded()) * 5
  }
}
