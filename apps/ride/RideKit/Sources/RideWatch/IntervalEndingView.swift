#if os(watchOS)
  import RideLink
  import RideStyle
  import SwiftUI

  /// The last seconds of an interval, counted down in a ring of the next interval's colour, with
  /// what comes next. The wrist taps along.
  struct IntervalEndingView: View {
    let glance: RideGlance
    let seconds: Int

    var body: some View {
      VStack(spacing: 4) {
        Text("\(seconds)")
          .font(.system(size: 62, weight: .semibold))
          .contentTransition(.numericText(countsDown: true))
          .animation(.default, value: seconds)
          .frame(width: 110, height: 110)
          .overlay {
            Circle().strokeBorder(color, lineWidth: 6)
          }
          .padding(.top, 10)
        Text("Next")
          .font(.system(size: 12))
          .foregroundStyle(.secondary)
          .padding(.top, 10)
        Text(nextTitle)
          .font(.system(size: 17, weight: .semibold))
          .foregroundStyle(color)
          .lineLimit(1)
          .minimumScaleFactor(0.7)
      }
      .monospacedDigit()
      .frame(maxWidth: .infinity)
      .navigationTitle {
        IntervalTitle(glance: glance)
      }
    }

    private var color: Color { glance.next?.zone.color ?? .green }

    /// Such as "Recovery · 120 W", or the end of the workout.
    private var nextTitle: String {
      guard let next = glance.next else { return "Finish" }
      guard let target = next.targetPower else { return next.zone.name }
      return "\(next.zone.name) · \(target) W"
    }
  }

  #Preview {
    var glance = RideGlance.sample()
    glance.interval?.remaining = 2
    return NavigationStack {
      IntervalEndingView(glance: glance, seconds: 2)
    }
  }
#endif
