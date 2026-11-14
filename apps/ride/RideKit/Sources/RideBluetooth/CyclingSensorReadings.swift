import Foundation

struct CyclingSensorReadings: Sendable {
  static let maxAge: TimeInterval = 5
  static let powerSourcesBestFirst: [CyclingCharacteristic] = [.power, .indoorBike]
  static let cadenceSourcesBestFirst: [CyclingCharacteristic] = [
    .indoorBike, .speedAndCadence, .power,
  ]

  private struct Reading: Sendable {
    let value: Int
    let date: Date
  }

  private var power: [CyclingCharacteristic: Reading] = [:]
  private var cadence: [CyclingCharacteristic: Reading] = [:]
  private var speed: (kilometresPerHour: Double, date: Date)?
  private var cranks: [CyclingCharacteristic: CrankCadence] = [:]
  private var powerCranks: [CyclingCharacteristic: CrankRevolution] = [:]
  private var powerCrankMoved: [CyclingCharacteristic: Date] = [:]

  mutating func receive(_ data: Data, from characteristic: CyclingCharacteristic, at date: Date) {
    switch characteristic {
    case .power:
      guard let measurement = CyclingPowerMeasurement(data) else { return }
      let crankMoved =
        measurement.crank == nil || measurement.watts == 0
        || measurement.crank != powerCranks[characteristic]
      powerCranks[characteristic] = measurement.crank
      if crankMoved { powerCrankMoved[characteristic] = date }
      power[characteristic] = Reading(
        value: measurement.watts, date: powerCrankMoved[characteristic] ?? date)
      if let crank = measurement.crank { receive(crank, from: characteristic, at: date) }
    case .speedAndCadence:
      guard let measurement = CyclingSpeedCadenceMeasurement(data) else { return }
      if let crank = measurement.crank { receive(crank, from: characteristic, at: date) }
    case .indoorBike:
      guard let measurement = IndoorBikeMeasurement(data) else { return }
      if let watts = measurement.watts {
        power[characteristic] = Reading(value: watts, date: date)
      }
      if let rpm = measurement.cadence {
        cadence[characteristic] = Reading(value: rpm, date: date)
      }
      if let kilometresPerHour = measurement.kilometresPerHour {
        speed = (kilometresPerHour, date)
      }
    }
  }

  func reading(
    for metric: RideMetric, at date: Date, heardWithin maxAge: TimeInterval = maxAge
  ) -> Int? {
    switch metric {
    case .power:
      current(power, preference: Self.powerSourcesBestFirst, at: date, heardWithin: maxAge)
    case .cadence:
      current(cadence, preference: Self.cadenceSourcesBestFirst, at: date, heardWithin: maxAge)
    case .heartRate: nil
    }
  }

  func kilometresPerHour(at date: Date) -> Double? {
    guard let speed, date.timeIntervalSince(speed.date) <= Self.maxAge else { return nil }
    return speed.kilometresPerHour
  }

  mutating func expire(at date: Date) {
    power = power.filter { date.timeIntervalSince($0.value.date) <= Self.maxAge }
    cadence = cadence.filter { date.timeIntervalSince($0.value.date) <= Self.maxAge }
  }

  private mutating func receive(
    _ crank: CrankRevolution, from characteristic: CyclingCharacteristic, at date: Date
  ) {
    let rpm = cranks[characteristic, default: CrankCadence()].update(crank, at: date)
    cadence[characteristic] = rpm.map { Reading(value: $0, date: date) }
  }

  private func current(
    _ readings: [CyclingCharacteristic: Reading], preference: [CyclingCharacteristic],
    at date: Date, heardWithin maxAge: TimeInterval
  ) -> Int? {
    preference.lazy.compactMap { readings[$0] }
      .first { date.timeIntervalSince($0.date) <= maxAge }?.value
  }
}
