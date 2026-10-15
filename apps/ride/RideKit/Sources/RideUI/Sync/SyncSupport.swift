import RideData

/// Syncing rides with iCloud.
public enum SyncSupport {
  /// Starts syncing. Call as the app launches: iCloud can launch the app in the background, with
  /// no window, to hand over a ride another device added.
  public static func activate() {
    _ = AppSync.shared
  }
}

/// The app's one `RideSync`, for the rides in `RideLibrary.launched`. On iPhone and iPad, a ride
/// Ride recorded on another device is saved to Health as it arrives.
enum AppSync {
  static let shared: RideSync = {
    let library = RideLibrary.launched
    let sync = RideSync(library: library)
    #if os(iOS)
      sync.onReceive = { id in
        guard let ride = library[id], FITDecoder.isRecordedByRide(ride.fileData) else { return }
        HealthRides.shared.save(id, from: library)
      }
    #endif
    sync.start()
    return sync
  }()
}
