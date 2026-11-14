struct HealthImportState: Codable, Equatable {
  var imported: Set<String> = []
  var deleted: Set<String> = []
}
