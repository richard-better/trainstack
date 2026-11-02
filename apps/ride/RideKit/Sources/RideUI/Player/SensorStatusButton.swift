import SwiftUI

struct SensorStatusButton: View {
  let controller: RideController
  @State private var isShowingDevices = false
  @ScaledMetric private var spacing = 14.0

  var body: some View {
    TimelineView(.periodic(from: .now, by: 1)) { context in
      let icons = controller.sensorStatuses(at: context.date).map(SensorStatusIcon.init)
      Button(action: showDevices) {
        HStack(spacing: spacing) {
          if icons.isEmpty {
            Image(systemName: "antenna.radiowaves.left.and.right.slash")
              .foregroundStyle(.secondary)
              .help("No sensors paired")
          }
          ForEach(icons, id: \.status.id) { $0 }
        }
        .padding(.horizontal, 4)
      }
      .accessibilityLabel("Sensors")
      .accessibilityValue(
        icons.isEmpty ? "None paired" : icons.map(\.summary).joined(separator: ", ")
      )
      .accessibilityHint("Shows your devices.")
    }
    .sheet(isPresented: $isShowingDevices) {
      DevicesSheet()
        #if os(macOS)
          .frame(minWidth: 480, minHeight: 520)
        #endif
    }
  }

  private func showDevices() { isShowingDevices = true }
}
