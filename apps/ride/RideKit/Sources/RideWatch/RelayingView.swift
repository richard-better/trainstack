#if os(watchOS)
  import SwiftUI

  /// Heart rate on its own, while the watch relays it for a ride the phone is not running, such
  /// as one on a Mac.
  struct RelayingView: View {
    let startDate: Date
    let heartRate: Int?
    let isPhoneConnected: Bool
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    var body: some View {
      VStack(alignment: .leading, spacing: 4) {
        Text(startDate, style: .timer)
          .font(.system(size: 20, weight: .semibold))
          .foregroundStyle(.secondary)
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text(heartRate.map(String.init) ?? "--")
            .font(.system(size: 56, weight: .semibold))
            .foregroundStyle(.pink.opacity(isLuminanceReduced ? 0.6 : 1))
            .contentTransition(.numericText())
          Text("bpm")
            .font(.system(size: 15))
            .foregroundStyle(.secondary)
        }
        Spacer(minLength: 0)
        Text(
          isPhoneConnected
            ? "Sending to iPhone, and on to Ride on your Mac."
            : "Looking for your iPhone. Keep it nearby with Bluetooth on."
        )
        .font(.system(size: 13))
        .foregroundStyle(.secondary)
      }
      .monospacedDigit()
      .frame(maxWidth: .infinity, alignment: .leading)
      .navigationTitle {
        Text("Heart Rate").foregroundStyle(.pink)
      }
    }
  }

  #Preview {
    NavigationStack {
      RelayingView(startDate: .now - 754, heartRate: 128, isPhoneConnected: true)
    }
  }
#endif
