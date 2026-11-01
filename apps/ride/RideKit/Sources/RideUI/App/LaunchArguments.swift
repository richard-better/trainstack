import Foundation
import RideBluetooth
import RideData
import RideStrava

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
    let journalDirectory = launchJournalDirectory()
    #if DEBUG
      let arguments = CommandLine.arguments
      if arguments.contains("-sample-rides") || arguments.contains("-simulated-trainer") {
        return RideLauncher(simulated: true, devices: devices, journalDirectory: journalDirectory)
      }
    #endif
    return RideLauncher(devices: devices, journalDirectory: journalDirectory)
  }

  /// Where rides are journalled, except that debug builds started with any flag that rides
  /// with pretend data journal in a folder of their own that no other launch looks in, so they
  /// neither leave the rider a ride to pick up nor find one.
  static func launchJournalDirectory(
    arguments: [String] = CommandLine.arguments
  ) -> URL {
    #if DEBUG
      let flags = ["-ride", "-sample-rides", "-simulated-trainer", "-sample-devices"]
      if flags.contains(where: arguments.contains) { return throwawayJournalDirectory }
    #endif
    return RideJournal.defaultDirectory
  }

  #if DEBUG
    /// A journal folder for this launch only, in the temporary folder.
    static let throwawayJournalDirectory = URL.temporaryDirectory.appending(
      path: "Ride in progress \(UUID().uuidString)", directoryHint: .isDirectory)
  #endif

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
  /// begin with only the sample ride, kept in memory. Shared by every window, and by iCloud
  /// syncing rides while the app has none.
  static let launched: RideLibrary = {
    #if DEBUG
      if CommandLine.arguments.contains("-sample-rides") { return .sample() }
    #endif
    return RideLibrary(directory: storageDirectory)
  }()

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

extension TrainStackAccount {
  /// The rider's account, except that debug builds started with
  /// `-trainstack-server <url> -trainstack-session <token>` talk to that server, signed in with
  /// that session token and keeping it in memory only, so account features can be tried
  /// against a local API without Sign in with Apple.
  static func launchAccount(arguments: [String] = CommandLine.arguments) -> TrainStackAccount {
    #if DEBUG
      func value(_ flag: String) -> String? {
        guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else {
          return nil
        }
        return arguments[index + 1]
      }
      if let server = value("-trainstack-server").flatMap(URL.init(string:)),
        let token = value("-trainstack-session")
      {
        return TrainStackAccount(
          server: server, store: InMemorySessionStore(AccountSession(token: token)))
      }
    #endif
    return TrainStackAccount()
  }
}
