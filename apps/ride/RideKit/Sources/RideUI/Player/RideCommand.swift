import RideData
import SwiftUI

enum RideCommand: Hashable {
  case togglePause
  case previousInterval
  case skipInterval
  case extendInterval
  case lap
  case mode(TrainerMode)
  case decrease
  case increase
  case togglePlayer
  case end

  static let allCases: [RideCommand] =
    [.togglePause, .previousInterval, .skipInterval, .extendInterval, .lap]
    + TrainerMode.allCases.map(mode)
    + [.decrease, .increase, .togglePlayer, .end]

  func title(in launcher: RideLauncher?) -> String {
    switch self {
    case .togglePause: launcher?.ride?.session.isPaused == true ? "Resume" : "Pause"
    case .previousInterval: "Previous Interval"
    case .skipInterval: "Skip Interval"
    case .extendInterval: "Add a Minute"
    case .lap: "Lap"
    case .mode(let mode): mode.rawValue
    case .decrease: "Easier"
    case .increase: "Harder"
    case .togglePlayer: launcher?.isPlayerPresented == true ? "Minimize Player" : "Show Player"
    case .end: "End Ride…"
    }
  }

  func shortcut(playerPresented: Bool) -> KeyboardShortcut? {
    switch self {
    case .togglePause: playerPresented ? KeyboardShortcut(.space, modifiers: []) : nil
    case .previousInterval: KeyboardShortcut(.leftArrow, modifiers: .command)
    case .skipInterval: KeyboardShortcut(.rightArrow, modifiers: .command)
    case .extendInterval: KeyboardShortcut("t", modifiers: .command)
    case .lap: KeyboardShortcut("l", modifiers: .command)
    case .mode(.erg): KeyboardShortcut("1", modifiers: .command)
    case .mode(.slope): KeyboardShortcut("2", modifiers: .command)
    case .mode(.level): KeyboardShortcut("3", modifiers: .command)
    case .decrease: KeyboardShortcut("-", modifiers: .command)
    case .increase: KeyboardShortcut("+", modifiers: .command)
    case .togglePlayer: KeyboardShortcut("p", modifiers: [.command, .shift])
    case .end: KeyboardShortcut("e", modifiers: [.command, .shift])
    }
  }

  func isEnabled(in launcher: RideLauncher?) -> Bool {
    guard let launcher, let ride = launcher.ride, !launcher.isConfirmingEnd else { return false }
    return switch self {
    case .skipInterval: !ride.session.isComplete
    case .extendInterval: ride.session.canExtendInterval
    default: true
    }
  }

  func isChecked(in launcher: RideLauncher?) -> Bool {
    if case .mode(let mode) = self { launcher?.ride?.mode == mode } else { false }
  }

  func perform(in launcher: RideLauncher) {
    guard isEnabled(in: launcher), let ride = launcher.ride else { return }
    switch self {
    case .togglePause: ride.togglePause()
    case .previousInterval: ride.previousInterval()
    case .skipInterval: ride.skipInterval()
    case .extendInterval: ride.extendInterval()
    case .lap: ride.markLap()
    case .mode(let mode): ride.mode = mode
    case .decrease: ride.adjust(by: -1)
    case .increase: ride.adjust(by: 1)
    case .togglePlayer: launcher.isPlayerPresented.toggle()
    case .end:
      launcher.isPlayerPresented = true
      launcher.isConfirmingEnd = true
    }
  }
}
