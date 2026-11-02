import RideData

enum AppSync {
  static let shared: RideSync = {
    let library = RideLibrary.launched
    let sync = RideSync(library: library)
    #if os(iOS)
      sync.onRideFromAnotherDevice = { id in
        guard let ride = library[id], FITDecoder.isRecordedByRide(ride.fileData) else { return }
        HealthRides.shared.save(id, from: library)
      }
    #endif
    sync.start()
    return sync
  }()
}
