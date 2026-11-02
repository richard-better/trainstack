import SwiftUI

#if os(macOS)
  struct RideBar: View {
    let controller: RideController
    let open: () -> Void

    static let height = 64.0

    var body: some View {
      RideAccessoryContent(controller: controller, open: open)
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .frame(maxWidth: 420)
        .glassEffect(.regular.interactive(), in: .capsule)
        .padding(.bottom, 8)
    }
  }
#endif
