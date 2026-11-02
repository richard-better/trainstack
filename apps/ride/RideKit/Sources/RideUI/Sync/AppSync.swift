import RideData

enum AppSync {
  static let shared: RideSync = {
    let library = RideLibrary.launched
    let sync = RideSync(library: library)
    #if os(iOS)
      sync.beforeStoringRideFromAnotherDevice = { ride in
        guard FITDecoder.isRecordedByRide(ride.fileData) else { return }
        HealthRides.shared.queue(ride.id, in: library)
      }
      sync.onRideFromAnotherDevice = { _ in HealthRides.shared.saveQueuedSoon(from: library) }
    #endif
    sync.start()
    return sync
  }()
}
