import RideData
import SwiftUI

/// The workout being ridden. The whole workout is on screen as a chart, with the four numbers
/// a rider checks most underneath it, big enough to read from the saddle.
struct PlayerView: View {
  let controller: RideController
  var onMinimize: () -> Void
  /// Called once the rider has ended the ride, with whether to keep it in History.
  var onEnd: (_ save: Bool) -> Void
  @State private var isConfirmingEnd = false

  var body: some View {
    // Everything on one screen when it fits; otherwise, such as in landscape or with large
    // text, the same layout scrolls.
    ViewThatFits(in: .vertical) {
      PlayerLayout(controller: controller)
      ScrollView { PlayerLayout(controller: controller) }
    }
    .monospacedDigit()
    .navigationTitle(controller.template.name)
    .navigationSubtitle(
      "\(controller.template.category.name) · \(Int((controller.template.duration / 60).rounded())) min"
    )
    #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
    #endif
    .toolbar {
      ToolbarItem(placement: minimizePlacement) {
        Button("Minimize", systemImage: "chevron.down", action: onMinimize)
          .help("Back to the app while the ride carries on")
      }
      if controller.hasSensors {
        ToolbarItem(placement: .primaryAction) {
          SensorStatusButton(controller: controller)
        }
      }
      ToolbarItem(placement: .primaryAction) {
        Button("End Ride", systemImage: "stop.fill", action: confirmEnd)
          .confirmationDialog("End this ride?", isPresented: $isConfirmingEnd) {
            Button("Save Ride") { onEnd(true) }
            Button("Discard Ride", role: .destructive) { onEnd(false) }
            Button("Keep Riding", role: .cancel) {}
          } message: {
            Text("A saved ride goes to History as a FIT file.")
          }
      }
    }
  }

  private var minimizePlacement: ToolbarItemPlacement {
    #if os(iOS)
      .cancellationAction
    #else
      .navigation
    #endif
  }

  private func confirmEnd() { isConfirmingEnd = true }
}

#Preview("Riding") {
  NavigationStack {
    PlayerView(controller: .preview(.named("Threshold classic 60")!, minutes: 21), onMinimize: {}) {
      _ in
    }
  }
  .frame(width: 1100, height: 760)
}

#Preview("Paused") {
  let controller = RideController.preview()
  controller.togglePause()
  return NavigationStack {
    PlayerView(controller: controller, onMinimize: {}) { _ in }
  }
  .frame(width: 800, height: 700)
}
