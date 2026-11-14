import RideData
import SwiftUI

struct PlayerControls: View {
  @Bindable var controller: RideController

  var body: some View {
    let session = controller.session
    let transport = HStack(spacing: 12) {
      Button(
        session.isPaused ? "Resume" : "Pause",
        systemImage: session.isPaused ? "play.fill" : "pause.fill", action: controller.togglePause
      )
      .labelStyle(.iconOnly)
      .buttonStyle(.glass)
      .keyboardShortcut(pause)
      .help(session.isPaused ? "Resume the ride" : "Pause the ride", shortcut: pause)
      Button(
        "Previous interval", systemImage: "backward.end.fill", action: controller.previousInterval
      )
      .labelStyle(.iconOnly)
      .buttonStyle(.glass)
      .disabled(session.isComplete)
      .keyboardShortcut(previous)
      .help("Go back to the start of the interval before this one", shortcut: previous)
      Button("Skip interval", systemImage: "forward.end.fill", action: controller.skipInterval)
        .labelStyle(.iconOnly)
        .buttonStyle(.glass)
        .disabled(session.isComplete)
        .keyboardShortcut(skip)
        .help(
          session.awaitsLap ? "End this step and start the next" : "Skip to the next interval",
          shortcut: skip)
      Button("Add a minute", systemImage: "goforward.plus", action: controller.extendInterval)
        .labelStyle(.iconOnly)
        .buttonStyle(.glass)
        .disabled(!session.canExtendInterval)
        .keyboardShortcut(extend)
        .help("Add a minute to this interval", shortcut: extend)
      Button("Lap", systemImage: "flag.fill", action: controller.markLap)
        .labelStyle(.iconOnly)
        .buttonStyle(.glass)
        .keyboardShortcut(lap)
        .help(
          session.awaitsLap ? "End this step and start the next" : "Mark a lap", shortcut: lap)
    }
    .controlSize(.large)
    #if os(macOS)
      .buttonBorderShape(.circle)
    #endif
    .fixedSize()
    let mode = SegmentedPicker(
      title: "Trainer mode", options: TrainerMode.allCases, selection: $controller.mode,
      label: \.rawValue
    )
    .fixedSize()
    .help(modeHelp)
    let stepper = SettingStepper(label: settingLabel, decrease: decrease, increase: increase)
      .fixedSize()
    GlassEffectContainer(spacing: 12) {
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 12) {
          transport
          Spacer()
          mode
          stepper
        }
        VStack(alignment: .leading, spacing: 10) {
          transport
          ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
              mode
              stepper
            }
            VStack(alignment: .leading, spacing: 10) {
              mode
              stepper
            }
          }
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }

  private var settingLabel: String {
    let session = controller.session
    return switch session.mode {
    case .erg: "\(session.ergPercent)%"
    case .slope: "\(session.slopeGradePercent.formatted(.oneDecimal))%"
    case .level: "Level \(session.level)"
    }
  }

  private var pause: KeyboardShortcut? { RideCommand.togglePause.shortcut(playerPresented: true) }

  private var skip: KeyboardShortcut? { RideCommand.skipInterval.shortcut(playerPresented: true) }

  private var previous: KeyboardShortcut? {
    RideCommand.previousInterval.shortcut(playerPresented: true)
  }

  private var extend: KeyboardShortcut? {
    RideCommand.extendInterval.shortcut(playerPresented: true)
  }

  private var lap: KeyboardShortcut? { RideCommand.lap.shortcut(playerPresented: true) }

  private var modeHelp: String {
    let keys = TrainerMode.allCases.compactMap { mode in
      RideCommand.mode(mode).shortcut(playerPresented: true).map {
        "\($0.symbols) \(mode.rawValue)"
      }
    }
    return "Trainer mode (\(keys.joined(separator: ", ")))"
  }

  private func decrease() { controller.adjust(by: -1) }

  private func increase() { controller.adjust(by: 1) }
}
