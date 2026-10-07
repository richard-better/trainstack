import RideData
import SwiftUI

/// The workout being ridden. The whole workout is on screen as a chart, with the four numbers
/// a rider checks most underneath it, big enough to read from the saddle.
struct PlayerView: View {
  let controller: RideController
  var onEnd: () -> Void
  @State private var isConfirmingEnd = false
  @Environment(\.dismiss) private var dismiss

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
      #if os(iOS)
        ToolbarItem(placement: .cancellationAction) {
          Button("Minimize", systemImage: "chevron.down", action: minimize)
        }
      #endif
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

  private func minimize() { dismiss() }

  private func confirmEnd() { isConfirmingEnd = true }
}

#Preview("Riding") {
  NavigationStack {
    PlayerView(controller: .preview(.named("Threshold classic 60")!, minutes: 21)) {}
  }
  .frame(width: 1100, height: 760)
}

#Preview("Paused") {
  let controller = RideController.preview()
  controller.togglePause()
  return NavigationStack {
    PlayerView(controller: controller) {}
  }
  .frame(width: 800, height: 700)
}
