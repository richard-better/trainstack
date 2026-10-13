import RideData
import SwiftUI

/// What Ride knows about the rider beyond their zones.
struct RiderPage: View {
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    @Bindable var store = store
    Form {
      Section {
        LabeledContent {
          HStack(spacing: 6) {
            TextField(
              "Weight", value: $store.weight, format: .number.precision(.fractionLength(0...1))
            )
            .labelsHidden()
            .multilineTextAlignment(.trailing)
            .frame(maxWidth: 80)
            #if os(iOS)
              .keyboardType(.decimalPad)
            #endif
            Text("kg").foregroundStyle(.secondary)
          }
        } label: {
          Text("Weight")
          Text("Sets how fast your power moves you on a ride, most of all uphill")
        }
      }
    }
    .formStyle(.grouped)
    .navigationTitle("Rider")
  }
}

#Preview {
  NavigationStack {
    RiderPage()
  }
  .environment(RiderSettingsStore.sample)
}
