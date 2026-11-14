import Foundation
import RideBluetooth
import RideCore
import RideData
import RideStrava

extension RiderSettingsStore {
  static let launched = launchStore()

  static func launchStore() -> RiderSettingsStore {
    #if DEBUG
      if CommandLine.arguments.contains("-sample-rides") { return .sample }
    #endif
    return RiderSettingsStore()
  }
}

extension RideLauncher {
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
    static let throwawayJournalDirectory = URL.temporaryDirectory.appending(
      path: "Ride in progress \(UUID().uuidString)", directoryHint: .isDirectory)
  #endif

  #if DEBUG
    func startLaunchRide(ftp: Int?, heartRateZones: ZoneSet?, riderWeight: Double) {
      let arguments = CommandLine.arguments
      guard let flag = arguments.firstIndex(of: "-ride"), flag + 1 < arguments.count,
        let template = WorkoutTemplate.named(arguments[flag + 1]), let ftp
      else { return }
      start(template.planned, ftp: ftp, heartRateZones: heartRateZones, riderWeight: riderWeight)
    }
  #endif
}

extension RideLibrary {
  static let launched: RideLibrary = {
    #if DEBUG
      if CommandLine.arguments.contains("-sample-rides") { return .sample() }
    #endif
    return RideLibrary(directory: storageDirectory)
  }()

  static func launchDestination() -> AppDestination {
    #if DEBUG
      if CommandLine.arguments.contains("-sample-rides") { return .history }
    #endif
    return .today
  }
}

extension BluetoothDevices {
  static func launchDevices() -> BluetoothDevices {
    #if DEBUG
      if CommandLine.arguments.contains("-sample-devices") { return .sample() }
    #endif
    return BluetoothDevices()
  }
}

extension TrainStackAccount {
  static let launched = launchAccount()

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

extension AccountWorkouts {
  static let launched = AccountWorkouts()
}

extension AccountCalendar {
  static let launched = AccountCalendar()
}
