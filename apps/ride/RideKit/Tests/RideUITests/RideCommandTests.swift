import Foundation
import RideData
import SwiftUI
import Testing

@testable import RideBluetooth
@testable import RideUI

struct RideCommandTests {
  private func launcher() -> RideLauncher {
    let defaults = UserDefaults(suiteName: "RideCommandTests.\(UUID().uuidString)")!
    let devices = BluetoothDevices(transport: CyclingTestTransport(), defaults: defaults)
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "RideCommandTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    return RideLauncher(simulated: true, devices: devices, journalDirectory: directory)
  }

  private func riding() -> RideLauncher {
    let launcher = launcher()
    launcher.start(
      .named("Quick test 45s")!, ftp: 200, heartRateZones: nil, riderWeight: 75)
    return launcher
  }

  @Test func nothingIsAvailableWithoutARide() {
    let launcher = launcher()
    for command in RideCommand.allCases {
      #expect(!command.isEnabled(in: launcher))
      #expect(!command.isEnabled(in: nil))
    }
  }

  @Test func everythingIsAvailableDuringARide() {
    let launcher = riding()
    for command in RideCommand.allCases {
      #expect(command.isEnabled(in: launcher))
    }
    launcher.end()
    for command in RideCommand.allCases {
      #expect(!command.isEnabled(in: launcher))
    }
  }

  @Test func skippingIsUnavailableOnceTheWorkoutIsDone() throws {
    let launcher = riding()
    let ride = try #require(launcher.ride)
    while !ride.session.isComplete { ride.skipInterval() }
    #expect(!RideCommand.skipInterval.isEnabled(in: launcher))
    #expect(RideCommand.togglePause.isEnabled(in: launcher))
    #expect(RideCommand.end.isEnabled(in: launcher))
  }

  @Test func nothingIsAvailableWhileConfirmingTheEnd() {
    let launcher = riding()
    RideCommand.end.perform(in: launcher)
    #expect(launcher.isConfirmingEnd)
    for command in RideCommand.allCases {
      #expect(!command.isEnabled(in: launcher))
    }
    RideCommand.togglePause.perform(in: launcher)
    #expect(launcher.ride?.session.isPaused == false)
  }

  @Test func endingAsksFirstAndShowsThePlayer() {
    let launcher = riding()
    launcher.isPlayerPresented = false
    RideCommand.end.perform(in: launcher)
    #expect(launcher.ride != nil)
    #expect(launcher.isPlayerPresented)
    #expect(launcher.isConfirmingEnd)
    launcher.end()
    #expect(!launcher.isConfirmingEnd)
  }

  @Test func commandsControlTheRide() throws {
    let launcher = riding()
    let ride = try #require(launcher.ride)

    RideCommand.togglePause.perform(in: launcher)
    #expect(ride.session.isPaused)
    #expect(RideCommand.togglePause.title(in: launcher) == "Resume")
    RideCommand.togglePause.perform(in: launcher)
    #expect(!ride.session.isPaused)

    RideCommand.mode(.slope).perform(in: launcher)
    #expect(ride.mode == .slope)
    #expect(RideCommand.mode(.slope).isChecked(in: launcher))
    #expect(!RideCommand.mode(.erg).isChecked(in: launcher))
    let grade = ride.session.grade
    RideCommand.increase.perform(in: launcher)
    #expect(ride.session.grade == grade + 0.5)
    RideCommand.decrease.perform(in: launcher)
    RideCommand.decrease.perform(in: launcher)
    #expect(ride.session.grade == grade - 0.5)

    let interval = ride.session.currentInterval
    RideCommand.skipInterval.perform(in: launcher)
    #expect(ride.session.currentInterval != interval)

    RideCommand.togglePlayer.perform(in: launcher)
    #expect(!launcher.isPlayerPresented)
    #expect(RideCommand.togglePlayer.title(in: launcher) == "Show Player")
  }

  @Test func spacePausesOnlyWhileThePlayerShows() {
    #expect(RideCommand.togglePause.shortcut(playerPresented: true)?.symbols == "Space")
    #expect(RideCommand.togglePause.shortcut(playerPresented: false) == nil)
  }

  @Test func onlyPausingTakesASingleKey() {
    for command in RideCommand.allCases where command != .togglePause {
      let shortcut = command.shortcut(playerPresented: true)
      #expect(shortcut?.modifiers.contains(.command) == true, "\(command)")
    }
    #expect(RideCommand.end.shortcut(playerPresented: true)?.symbols == "⇧⌘E")
  }

  @Test func shortcutsAreDistinct() {
    let symbols = RideCommand.allCases.compactMap { $0.shortcut(playerPresented: true)?.symbols }
    #expect(symbols.count == RideCommand.allCases.count)
    #expect(Set(symbols).count == symbols.count)
    #expect(symbols == ["Space", "⌘→", "⌘1", "⌘2", "⌘3", "⌘-", "⌘+", "⇧⌘P", "⇧⌘E"])
  }
}
