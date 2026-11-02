#if os(watchOS)
  import SwiftUI

  struct ControlsView: View {
    let end: () -> Void

    var body: some View {
      VStack(spacing: 8) {
        Button("End", systemImage: "xmark", role: .destructive, action: end)
          .tint(.red)
        Text("Stops heart rate and saves the workout to Health. A ride on your iPhone carries on.")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }
      .navigationTitle("Workout")
    }
  }

  #Preview {
    NavigationStack {
      ControlsView {}
    }
  }
#endif
