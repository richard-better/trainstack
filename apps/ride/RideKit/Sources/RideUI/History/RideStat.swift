struct RideStat: Identifiable {
  let label: String
  let value: String
  var unit: String?
  var id: String { label }
}
