public enum WatchSupport {
  public static func activateAtLaunch() {
    #if os(iOS)
      WatchLink.activateAtLaunch()
    #endif
  }
}
