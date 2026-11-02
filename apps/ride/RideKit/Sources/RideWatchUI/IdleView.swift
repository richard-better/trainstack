#if os(watchOS)
  import SwiftUI

  struct IdleView: View {
    let start: () -> Void

    var body: some View {
      ScrollView {
        VStack(alignment: .leading, spacing: 12) {
          Text("Start a ride on your iPhone and Ride opens here.")
            .foregroundStyle(.secondary)
          Button("Relay Heart Rate", systemImage: "heart.fill", action: start)
            .tint(.pink)
          Text("Sends your heart rate to your iPhone, and through it to Ride on your Mac.")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      }
      .navigationTitle("Ride")
    }
  }

  #Preview {
    NavigationStack {
      IdleView {}
    }
  }
#endif
