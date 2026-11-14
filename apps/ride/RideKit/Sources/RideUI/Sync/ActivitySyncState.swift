struct ActivitySyncState: Codable, Equatable {
  var onServer: Set<Ride.ID> = []
  var deleted: Set<Ride.ID> = []
  var deletionsToSend: Set<Ride.ID> = []
  var restoresToSend: Set<Ride.ID> = []

  init() {}

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    onServer = try container.decode(Set<Ride.ID>.self, forKey: .onServer)
    deleted = try container.decode(Set<Ride.ID>.self, forKey: .deleted)
    deletionsToSend = try container.decode(Set<Ride.ID>.self, forKey: .deletionsToSend)
    restoresToSend =
      try container.decodeIfPresent(Set<Ride.ID>.self, forKey: .restoresToSend) ?? []
  }
}
