/// The app's link to Ride on the Apple Watch.
public enum WatchSupport {
  /// Starts listening for the watch. Call as the app launches: HealthKit can launch the app in
  /// the background, with no window, to hand over a workout the rider started on the watch.
  public static func activate() {
    #if os(iOS)
      WatchLink.activate()
    #endif
  }
}
