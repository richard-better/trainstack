/// The FTMS characteristics a trainer is controlled through.
enum TrainerCharacteristic: String, CaseIterable, Sendable {
  case controlPoint = "2AD9"
  case status = "2ADA"
  case resistanceRange = "2AD6"
  case powerRange = "2AD8"
}
