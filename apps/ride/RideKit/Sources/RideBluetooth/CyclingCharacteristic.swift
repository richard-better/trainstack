/// Standard cycling measurements supported by the transport.
enum CyclingCharacteristic: String, CaseIterable, Sendable {
  case power = "2A63"
  case speedAndCadence = "2A5B"
  case indoorBike = "2AD2"
}
