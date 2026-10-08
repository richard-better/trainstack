import SwiftUI

/// The Devices page as a sheet, opened from a screen's device status.
struct DevicesSheet: View {
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      DevicesView()
        #if os(iOS)
          .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
          ToolbarItem(placement: .confirmationAction) {
            Button("Done", action: close)
          }
        }
    }
  }

  private func close() { dismiss() }
}
