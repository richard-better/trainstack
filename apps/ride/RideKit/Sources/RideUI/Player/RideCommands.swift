import RideData
import SwiftUI

/// The Controls menu: the player's controls with their keyboard shortcuts, in the menu bar on the
/// Mac and in the shortcuts overlay when holding ⌘ on iPad. They work on the ride in the
/// focused window, and only while one is on.
public struct RideCommands: Commands {
  @FocusedValue(\.rideLauncher) private var launcher

  public init() {}

  public var body: some Commands {
    CommandMenu("Controls") {
      item(.togglePause)
      item(.skipInterval)
      Section("Trainer Mode") {
        ForEach(TrainerMode.allCases, id: \.self) { mode in
          Toggle(RideCommand.mode(mode).title(in: launcher), isOn: modeBinding(mode))
            .keyboardShortcut(RideCommand.mode(mode).shortcut(playerPresented: isPlayerPresented))
            .disabled(!RideCommand.mode(mode).isEnabled(in: launcher))
        }
      }
      Divider()
      item(.decrease)
      item(.increase)
      Divider()
      item(.togglePlayer)
      item(.end)
    }
  }

  private var isPlayerPresented: Bool { launcher?.isPlayerPresented ?? false }

  private func item(_ command: RideCommand) -> some View {
    Button(command.title(in: launcher)) {
      if let launcher { command.perform(in: launcher) }
    }
    .keyboardShortcut(command.shortcut(playerPresented: isPlayerPresented))
    .disabled(!command.isEnabled(in: launcher))
  }

  /// Ticked for the trainer's mode, and switches to the mode when chosen.
  private func modeBinding(_ mode: TrainerMode) -> Binding<Bool> {
    Binding(
      get: { RideCommand.mode(mode).isChecked(in: launcher) },
      set: { _ in
        if let launcher { RideCommand.mode(mode).perform(in: launcher) }
      })
  }
}

extension FocusedValues {
  /// What starts and ends rides in the focused window, for the Controls menu.
  @Entry var rideLauncher: RideLauncher?
}
