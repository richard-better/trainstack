#if os(watchOS)
  import RideLink
  import RideStyle
  import SwiftUI

  struct IntervalTitle: View {
    let glance: RideGlance
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    var body: some View {
      if glance.isPaused {
        Text("Paused").foregroundStyle(.orange)
      } else if let interval = glance.interval {
        Text(interval.title)
          .foregroundStyle(interval.zone.color.opacity(isLuminanceReduced ? 0.55 : 1))
      } else {
        Text("Done").foregroundStyle(.green)
      }
    }
  }
#endif
