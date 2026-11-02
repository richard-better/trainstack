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
  private var cranks: [CyclingCharacteristic: CrankCadence] = [:]

  mutating func receive(_ data: Data, from characteristic: CyclingCharacteristic, at date: Date) {
    switch characteristic {
    case .power:
      guard let measurement = CyclingPowerMeasurement(data) else { return }
      power[characteristic] = Reading(value: measurement.watts, date: date)
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
    }
  }

  func reading(for metric: RideMetric, at date: Date) -> Int? {
    switch metric {
    case .power: current(power, preference: Self.powerSourcesBestFirst, at: date)
    case .cadence: current(cadence, preference: Self.cadenceSourcesBestFirst, at: date)
    case .heartRate: nil
    }
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
    _ readings: [CyclingCharacteristic: Reading], preference: [CyclingCharacteristic], at date: Date
  ) -> Int? {
    preference.lazy.compactMap { readings[$0] }
      .first { date.timeIntervalSince($0.date) <= Self.maxAge }?.value
  }
}
