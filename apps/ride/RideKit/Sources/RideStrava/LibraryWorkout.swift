import Foundation
import RideData

public struct LibraryWorkout: Hashable, Codable, Identifiable, Sendable {
  public let id: String
  public var name: String
  public var sport: String
  public var focus: String?
  public var description: String?
  public var copiedFromBuiltin: String?
  public var updatedAt: Date
  public var body: Data

  public init(
    id: String, name: String, sport: String, focus: String? = nil, description: String? = nil,
    copiedFromBuiltin: String? = nil, updatedAt: Date, body: Data
  ) {
    self.id = id
    self.name = name
    self.sport = sport
    self.focus = focus
    self.description = description
    self.copiedFromBuiltin = copiedFromBuiltin
    self.updatedAt = updatedAt
    self.body = body
  }

  public init(id: String, workout: TrainStackWorkout, copiedFromBuiltin: String?, updatedAt: Date)
    throws
  {
    self.init(
      id: id, name: workout.name, sport: workout.sport.rawValue, focus: workout.focus?.rawValue,
      description: workout.description, copiedFromBuiltin: copiedFromBuiltin,
      updatedAt: updatedAt, body: try JSONEncoder().encode(workout))
  }

  public var workout: TrainStackWorkout? {
    try? JSONDecoder().decode(TrainStackWorkout.self, from: body)
  }

  public var rideability: Rideability? { workout?.rideability }
}
