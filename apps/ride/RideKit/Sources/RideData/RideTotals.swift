import Foundation

/// What a ride adds up to so far, for the player. Worked out from the ride as it would be saved,
/// so the numbers match History's once it is, and paused time is left out the same way.
public struct RideTotals: Equatable, Sendable {
  public var averagePower: Int?
  public var normalizedPower: Int?
  /// Kilojoules.
  public var work: Int?
  public var intensityFactor: Double?
  public var stressScore: Int?
  public var averageHeartRate: Int?
  /// Average power over the current interval so far.
  public var intervalAveragePower: Int?

  /// Nothing ridden yet.
  public init() {}

  /// The totals of `session` so far, with intensity and stress against `ftp`. Each pass over
  /// the ride is linear in its length, so this suits working out once a second, not each frame.
  public init(session: RideSession, ftp: Int) {
    let recording = session.recording()
    averagePower = recording.summary.averagePower
    normalizedPower = recording.normalizedPower()
    work = recording.work()
    intensityFactor = recording.intensityFactor(ftp: ftp)
    stressScore = recording.trainingStressScore(ftp: ftp)
    averageHeartRate = recording.summary.averageHeartRate
    intervalAveragePower = session.intervalAveragePower
  }
}
