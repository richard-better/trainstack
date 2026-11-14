import Foundation
import RideData

public enum RideInput: Equatable, Codable, Sendable {
  case begin(trainerConnected: Bool)
  case resumeAfterCrash(trainerConnected: Bool)
  case tick(seconds: TimeInterval, reading: TrainerReading, trainerConnected: Bool)
  case togglePause
  case skipInterval
  case markLap
  case adjust(steps: Int)
  case changeMode(TrainerMode)
}
