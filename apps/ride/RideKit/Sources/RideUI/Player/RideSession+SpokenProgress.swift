import RideData

extension RideSession {
  var spokenProgress: String {
    if let free = freeRideElapsed {
      return "Workout complete, free ride \(free.spokenString)"
    }
    return "\(position.spokenString) of \(duration.spokenString) done"
  }
}
