import SwiftUI

#if os(iOS)
  struct RideAccessory: View {
    let controller: RideController
    let open: () -> Void
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    var body: some View {
      RideAccessoryContent(controller: controller, isInline: placement == .inline, open: open)
        .padding(.horizontal, 16)
    }
  }
#endif
