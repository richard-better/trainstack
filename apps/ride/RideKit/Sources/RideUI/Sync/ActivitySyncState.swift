struct ActivitySyncState: Codable, Equatable {
  var onServer: Set<Ride.ID> = []
  var deleted: Set<Ride.ID> = []
  var deletionsToSend: Set<Ride.ID> = []
}
