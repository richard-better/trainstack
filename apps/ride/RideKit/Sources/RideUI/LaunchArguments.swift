import RideData

extension RiderSettingsStore {
  /// The saved profile, except that debug builds started with `-sample-rides` use the sample one.
  static func launchStore() -> RiderSettingsStore {
    #if DEBUG
      if CommandLine.arguments.contains("-sample-rides") { return .sample }
    #endif
    return RiderSettingsStore()
  }
}

extension RideLauncher {
  /// Debug builds started with `-sample-rides` or `-simulated-trainer` ride with a pretend
  /// trainer, so the player can be tried without hardware.
  static func launchLauncher() -> RideLauncher {
    #if DEBUG
      let arguments = CommandLine.arguments
      if arguments.contains("-sample-rides") || arguments.contains("-simulated-trainer") {
        return RideLauncher(simulated: true)
      }
    #endif
    return RideLauncher()
  }

  #if DEBUG
    /// Debug builds started with `-ride "<workout name>"` open straight into that ride.
    func startLaunchRide(ftp: Int?) {
      let arguments = CommandLine.arguments
      guard let flag = arguments.firstIndex(of: "-ride"), flag + 1 < arguments.count,
        let template = WorkoutTemplate.named(arguments[flag + 1]), let ftp
      else { return }
      start(template, ftp: ftp)
    }
  #endif
}

extension RideLibrary {
  /// Empty, except that debug builds started with `-sample-rides` begin with the sample ride.
  static func launchLibrary() -> RideLibrary {
    #if DEBUG
      if CommandLine.arguments.contains("-sample-rides") { return .sample() }
    #endif
    return RideLibrary()
  }

  /// Debug builds started with `-sample-rides` open on History, where the sample ride is.
  static func launchDestination() -> AppDestination {
    #if DEBUG
      if CommandLine.arguments.contains("-sample-rides") { return .history }
    #endif
    return .today
  }
}
