import SwiftUI

public struct RootView: View {
  public init() {}

  public var body: some View {
    ContentUnavailableView(
      "TrainStack Ride",
      systemImage: "bicycle",
      description: Text("Connect a trainer to start riding.")
    )
  }
}

#Preview {
  RootView()
}
