import Foundation

public struct RideTotals: Equatable, Sendable {
  public var averagePower: Int?
  public var normalizedPower: Int?
  public var workKilojoules: Int?
  public var intensityFactor: Double?
  public var stressScore: Int?
  public var averageHeartRate: Int?
  public var intervalAveragePower: Int?

  public init() {}

  public init(session: RideSession, ftp: Int) {
    let recording = session.recording()
    averagePower = recording.summary.averagePower
    normalizedPower = recording.normalizedPower()
    workKilojoules = recording.workKilojoules()
    intensityFactor = recording.intensityFactor(ftp: ftp)
    stressScore = recording.trainingStressScore(ftp: ftp)
    averageHeartRate = recording.summary.averageHeartRate
    intervalAveragePower = session.intervalAveragePower
  }
}
