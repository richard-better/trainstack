import RideBluetooth
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
    let devices = BluetoothDevices.launchDevices()
    #if DEBUG
      let arguments = CommandLine.arguments
      if arguments.contains("-sample-rides") || arguments.contains("-simulated-trainer") {
        return RideLauncher(simulated: true, devices: devices)
      }
    #endif
    return RideLauncher(devices: devices)
  }

  #if DEBUG
    /// Debug builds started with `-ride "<workout name>"` open straight into that ride.
    func startLaunchRide(ftp: Int?, heartRateZones: ZoneSet?, riderWeight: Double) {
      let arguments = CommandLine.arguments
      guard let flag = arguments.firstIndex(of: "-ride"), flag + 1 < arguments.count,
        let template = WorkoutTemplate.named(arguments[flag + 1]), let ftp
      else { return }
      start(template, ftp: ftp, heartRateZones: heartRateZones, riderWeight: riderWeight)
    }
  #endif
}

extension RideLibrary {
  /// The rides saved on this device, except that debug builds started with `-sample-rides`
  /// begin with only the sample ride, kept in memory.
  static func launchLibrary() -> RideLibrary {
    #if DEBUG
      if CommandLine.arguments.contains("-sample-rides") { return .sample() }
    #endif
    return RideLibrary(directory: storageDirectory)
  }

  /// Debug builds started with `-sample-rides` open on History, where the sample ride is.
  static func launchDestination() -> AppDestination {
    #if DEBUG
      if CommandLine.arguments.contains("-sample-rides") { return .history }
    #endif
    return .today
  }
}

extension BluetoothDevices {
  /// The rider's devices, except that debug builds started with `-sample-devices` use
  /// pretend ones, since the simulator has no Bluetooth.
  static func launchDevices() -> BluetoothDevices {
    #if DEBUG
      if CommandLine.arguments.contains("-sample-devices") { return .sample() }
    #endif
    return BluetoothDevices()
  }
}
