import SwiftUI

public struct RootView: View {
  @State private var showsDevices = false

  public init() {}

  public var body: some View {
    NavigationStack {
      ContentUnavailableView {
        Label("TrainStack Ride", systemImage: "bicycle")
      } description: {
        Text("Find your trainer and sensors to get started.")
      } actions: {
        Button("Find devices") { showsDevices = true }
          .buttonStyle(.borderedProminent)
      }
      .navigationTitle("Ride")
      .toolbar {
        ToolbarItem(placement: .primaryAction) {
          Button("Devices", systemImage: "antenna.radiowaves.left.and.right") {
            showsDevices = true
          }
        }
      }
    }
    .sheet(isPresented: $showsDevices) {
      DevicesView()
    }
  }
}

#Preview {
  RootView()
}
