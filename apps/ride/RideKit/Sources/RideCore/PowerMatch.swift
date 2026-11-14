import Foundation
import RideData

public struct PowerMatch: Equatable, Sendable {
  public static let largestCorrection = 0.1
  public static let settleSeconds: TimeInterval = 5
  public static let learningTimeConstantSeconds: TimeInterval = 20
  public static let lowestMatchedWatts = 50
  public static let holdingShare = 0.05
  public static let plausibleRatios = 0.8...1.25
  public static let meterSilenceSeconds: TimeInterval = 5
  static let commandChangeShare = 0.03
  static let commandChangeWatts = 5.0

  public private(set) var ratio = 1.0
  private var settled: TimeInterval = 0
  private var settledCommand: Int?
  private var meterQuiet: TimeInterval = 0

  public init() {}

  public var correction: Double { ratio - 1 }

  public func watts(for target: Int) -> Int {
    Int((Double(target) * ratio).rounded())
  }

  mutating func observe(
    _ reading: PowerMatchReading?, commanded: Int?, over seconds: TimeInterval
  ) {
    guard let reading else {
      self = PowerMatch()
      return
    }
    noteCommand(commanded, over: seconds)
    let meter = reading.meter
    let trainer = reading.trainer
    if Self.meterHasGoneQuiet(meter: meter, trainer: trainer) {
      meterQuiet += seconds
      if meterQuiet >= Self.meterSilenceSeconds { forgetRatio() }
      return
    }
    meterQuiet = 0
    guard let commanded, settled >= Self.settleSeconds, let meter, let trainer,
      meter >= Self.lowestMatchedWatts, trainer >= Self.lowestMatchedWatts,
      Double(abs(trainer - commanded)) <= Self.holdingShare * Double(commanded)
    else { return }
    let sample = Double(trainer) / Double(meter)
    guard Self.plausibleRatios.contains(sample) else { return }
    let weight = min(1, seconds / Self.learningTimeConstantSeconds)
    ratio = (ratio + (sample - ratio) * weight)
      .clamped(to: (1 - Self.largestCorrection)...(1 + Self.largestCorrection))
  }

  private static func meterHasGoneQuiet(meter: Int?, trainer: Int?) -> Bool {
    guard let meter else { return true }
    return meter < lowestMatchedWatts && (trainer ?? 0) >= lowestMatchedWatts
  }

  private mutating func forgetRatio() {
    ratio = 1
    settled = 0
  }

  private mutating func noteCommand(_ commanded: Int?, over seconds: TimeInterval) {
    guard let commanded else {
      settledCommand = nil
      settled = 0
      return
    }
    if let settledCommand,
      Double(abs(commanded - settledCommand))
        <= max(Self.commandChangeWatts, Self.commandChangeShare * Double(settledCommand))
    {
      settled += seconds
    } else {
      settledCommand = commanded
      settled = 0
    }
  }
}

extension Comparable {
  fileprivate func clamped(to range: ClosedRange<Self>) -> Self {
    min(max(self, range.lowerBound), range.upperBound)
  }
}
