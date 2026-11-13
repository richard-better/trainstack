public enum SyncSupport {
  public static func activateAtLaunch() {
    _ = AppSync.shared
    _ = AppActivitySync.shared
  }
}
