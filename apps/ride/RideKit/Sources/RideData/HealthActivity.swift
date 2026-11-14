import Foundation

public struct HealthActivity: Equatable, Sendable {
  public struct Reading: Equatable, Sendable {
    public var date: Date
    public var value: Double

    public init(date: Date, value: Double) {
      self.date = date
      self.value = value
    }
  }

  public struct Location: Equatable, Sendable {
    public var date: Date
    public var latitude: Double
    public var longitude: Double
    public var altitudeMetres: Double?
    public var speedMetresPerSecond: Double?

    public init(
      date: Date, latitude: Double, longitude: Double, altitudeMetres: Double? = nil,
      speedMetresPerSecond: Double? = nil
    ) {
      self.date = date
      self.latitude = latitude
      self.longitude = longitude
      self.altitudeMetres = altitudeMetres
      self.speedMetresPerSecond = speedMetresPerSecond
    }
  }

  public struct Pause: Equatable, Sendable {
    public var from: Date
    public var to: Date

    public init(from: Date, to: Date) {
      self.from = from
      self.to = to
    }
  }

  public var sport: HealthSport
  public var startDate: Date
  public var endDate: Date
  public var utcOffsetSeconds: Int?
  public var heartRate: [Reading]
  public var power: [Reading]
  public var cadence: [Reading]
  public var speed: [Reading]
  public var distanceSoFar: [Reading]
  public var locations: [Location]
  public var pauses: [Pause]
  public var totalDistanceMetres: Double?
  public var activeKilocalories: Double?
  public var ascentMetres: Double?

  public init(
    sport: HealthSport, startDate: Date, endDate: Date, utcOffsetSeconds: Int? = nil,
    heartRate: [Reading] = [], power: [Reading] = [], cadence: [Reading] = [],
    speed: [Reading] = [], distanceSoFar: [Reading] = [], locations: [Location] = [],
    pauses: [Pause] = [], totalDistanceMetres: Double? = nil, activeKilocalories: Double? = nil,
    ascentMetres: Double? = nil
  ) {
    self.sport = sport
    self.startDate = startDate
    self.endDate = endDate
    self.utcOffsetSeconds = utcOffsetSeconds
    self.heartRate = heartRate
    self.power = power
    self.cadence = cadence
    self.speed = speed
    self.distanceSoFar = distanceSoFar
    self.locations = locations
    self.pauses = pauses
    self.totalDistanceMetres = totalDistanceMetres
    self.activeKilocalories = activeKilocalories
    self.ascentMetres = ascentMetres
  }
}
