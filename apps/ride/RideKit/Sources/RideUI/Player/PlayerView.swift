import RideData
import SwiftUI

/// The workout being ridden. The whole workout is on screen as a chart, with the four numbers
/// a rider checks most underneath it, big enough to read from the saddle.
struct PlayerView: View {
  let controller: RideController
  var onMinimize: () -> Void
  var onEnd: () -> Void
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
      ToolbarItem(placement: .primaryAction) {
        Button("End Ride", systemImage: "stop.fill", action: confirmEnd)
          .confirmationDialog("End this ride?", isPresented: $isConfirmingEnd) {
            Button("End Ride", role: .destructive, action: onEnd)
            Button("Keep Riding", role: .cancel) {}
          } message: {
            Text("Rides aren't saved to History yet.")
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
    }
  }
  .frame(width: 1100, height: 760)
}

#Preview("Paused") {
  let controller = RideController.preview()
  controller.togglePause()
  return NavigationStack {
    PlayerView(controller: controller, onMinimize: {}) {}
  }
  .frame(width: 800, height: 700)
}
