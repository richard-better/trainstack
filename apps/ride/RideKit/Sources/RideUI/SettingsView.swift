import RideData
import SwiftUI

/// The numbers a rider's zones and training stress are measured against.
struct SettingsView: View {
  @Environment(RiderProfileStore.self) private var profile

  var body: some View {
    @Bindable var profile = profile
    Form {
      Section {
        numberField("Max heart rate (bpm)", value: $profile.maxHeartRate)
      } header: {
        Text("Heart rate")
      } footer: {
        Text(
          "Sets your heart rate zones. Between \(RiderProfile.maxHeartRateRange.lowerBound) and \(RiderProfile.maxHeartRateRange.upperBound)."
        )
      }
      Section {
        numberField("FTP (watts)", value: $profile.ftp)
      } header: {
        Text("Power")
      } footer: {
        Text(
          "Functional threshold power, the most you could hold for about an hour. Sets your power zones and training stress. Between \(RiderProfile.ftpRange.lowerBound) and \(RiderProfile.ftpRange.upperBound)."
        )
      }
    }
    .formStyle(.grouped)
    .navigationTitle("Settings")
  }

  private func numberField(_ title: LocalizedStringKey, value: Binding<Int?>) -> some View {
    TextField(title, value: value, format: .number.grouping(.never), prompt: Text("Not set"))
      .multilineTextAlignment(.trailing)
      #if os(iOS)
        .keyboardType(.numberPad)
      #endif
  }
}

#Preview {
  NavigationStack {
    SettingsView()
  }
  .environment(RiderProfileStore.sample)
}
