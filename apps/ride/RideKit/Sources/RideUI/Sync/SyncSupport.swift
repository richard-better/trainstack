public enum SyncSupport {
  public static func activateAtLaunch() {
    _ = AppSync.shared
    _ = AppActivitySync.shared
    _ = AppSettingsSync.shared
    _ = AppWorkoutSync.shared
    _ = AppCalendarSync.shared
  }
}
