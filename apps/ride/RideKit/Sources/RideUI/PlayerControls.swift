import RideData
import SwiftUI

/// Pause, skip, the trainer mode and its setting. One row with room to spare, otherwise the
/// transport above the trainer controls, which themselves stack when even that is too narrow.
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
      .keyboardShortcut(.space, modifiers: [])
      Button("Skip interval", systemImage: "forward.end.fill", action: controller.skipInterval)
        .labelStyle(.iconOnly)
        .buttonStyle(.glass)
        .disabled(session.isComplete)
        .keyboardShortcut(.rightArrow, modifiers: .command)
        .help("Skip to the next interval (⌘→)")
    }
    #if os(iOS)
      .controlSize(.large)
    #endif
    .fixedSize()
    let mode = Picker("Trainer mode", selection: $controller.mode) {
      ForEach(TrainerMode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
    }
    .pickerStyle(.segmented)
    .labelsHidden()
    .fixedSize()
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
    case .slope: "\(session.grade.formatted(.oneDecimal))%"
    case .level: "Level \(session.level)"
    }
  }

  private func decrease() { controller.adjust(by: -1) }

  private func increase() { controller.adjust(by: 1) }
}
