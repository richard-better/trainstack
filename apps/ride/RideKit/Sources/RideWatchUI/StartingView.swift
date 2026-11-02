#if os(watchOS)
  import SwiftUI

  struct StartingView: View {
    let count: Int
    let workoutName: String?
    let heartRate: Int?
    let isPhoneConnected: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
      VStack(alignment: .leading, spacing: 6) {
        Text("Started on iPhone")
          .font(.system(size: 13))
          .foregroundStyle(.secondary)
        Text(workoutName ?? " ")
          .font(.system(size: 20, weight: .semibold))
          .lineLimit(2)
          .minimumScaleFactor(0.7)
        Spacer(minLength: 0)
        VStack(spacing: 6) {
          Text("\(count)")
            .font(.system(size: 56, weight: .semibold))
            .contentTransition(.numericText(countsDown: true))
            .animation(reduceMotion ? nil : .default, value: count)
          HeartRateStatus(heartRate: heartRate, isPhoneConnected: isPhoneConnected)
        }
        .frame(maxWidth: .infinity)
      }
      .monospacedDigit()
      .screenTitle {
        Text("Ride").foregroundStyle(.yellow)
      }
    }
  }

  private struct HeartRateStatus: View {
    let heartRate: Int?
    let isPhoneConnected: Bool

    var body: some View {
      Label {
        Text("\(heartRate.map(String.init) ?? "--") · \(status)")
      } icon: {
        Image(systemName: "heart.fill").foregroundStyle(.pink)
      }
      .font(.system(size: 13))
      .foregroundStyle(.secondary)
      .labelStyle(.titleAndIcon)
    }

    private var status: String {
      isPhoneConnected ? "sending to iPhone" : "finding iPhone"
    }
  }

  #Preview {
    NavigationStack {
      StartingView(
        count: 3, workoutName: "Threshold waves 3×12", heartRate: 72, isPhoneConnected: true)
    }
  }
#endif
