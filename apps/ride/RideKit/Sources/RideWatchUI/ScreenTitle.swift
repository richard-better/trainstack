#if os(watchOS)
  import SwiftUI

  extension View {
    func screenTitle(@ViewBuilder _ title: () -> some View) -> some View {
      let title = title()
      return toolbar {
        ToolbarItem(placement: .topBarLeading) {
          title
            .font(.system(size: 15, weight: .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
      }
    }
  }
#endif
