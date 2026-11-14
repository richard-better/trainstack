import RideData
import SwiftUI

struct RampTestResultView: View {
  let outcome: RampTestOutcome
  @State private var hasSetFTP = false
  @State private var hasSetMaxHeartRate = false
  @Environment(RiderSettingsStore.self) private var store
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      Form {
        if let result = outcome.result {
          estimate(result)
          if let maxHeartRate = result.maxHeartRate,
            store.offersMaxHeartRate(maxHeartRate) || hasSetMaxHeartRate
          {
            heartRate(maxHeartRate)
          }
        } else {
          ContentUnavailableView(
            "No Estimate", systemImage: "chart.line.uptrend.xyaxis",
            description: Text("The test ended before a full minute of riding with power."))
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Ramp Test Result")
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
    }
    #if os(macOS)
      .frame(minWidth: 420, minHeight: 480)
    #endif
  }

  @ViewBuilder
  private func estimate(_ result: RampTestResult) -> some View {
    Section {
      LabeledContent("FTP estimate") {
        Text("\(result.ftp) W").font(.largeTitle.weight(.semibold)).monospacedDigit()
      }
    }
    Section("How it was worked out") {
      LabeledContent("Best minute", value: "\(result.bestMinuteWatts) W")
      LabeledContent(
        "Ridden",
        value:
          "\(result.bestMinuteStart.clockString)–\((result.bestMinuteStart + RampTest.stepSeconds).clockString)"
      )
      LabeledContent("75% of \(result.bestMinuteWatts) W", value: "\(result.ftp) W")
      LabeledContent("Your FTP now", value: store[.ftp, ftpScope].map { "\($0) W" } ?? "Not set")
    }
    Section {
      Button(hasSetFTP ? "FTP Set to \(result.ftp) W" : "Set FTP to \(result.ftp) W from Today") {
        store.keepRampTestFTP(result.ftp)
        hasSetFTP = true
      }
      .disabled(hasSetFTP)
    } footer: {
      Text(
        "Kept as a ramp test dated today, and your zones use the new FTP from today. It reaches your Trainstack account like any other setting."
      )
    }
  }

  @ViewBuilder
  private func heartRate(_ highest: Int) -> some View {
    Section {
      LabeledContent("Highest heart rate", value: "\(highest) bpm")
      LabeledContent(
        "Your max heart rate",
        value: store[.maxHeartRate, heartRateScope].map { "\($0) bpm" } ?? "Not set")
      Button(
        hasSetMaxHeartRate
          ? "Max Heart Rate Set to \(highest) bpm" : "Set Max Heart Rate to \(highest) bpm"
      ) {
        store.keepMaxHeartRate(highest)
        hasSetMaxHeartRate = true
      }
      .disabled(hasSetMaxHeartRate)
    } footer: {
      Text(
        "This is higher than your max heart rate. Set it only if you rode yourself out: a ramp test takes you close to your maximum, but not always."
      )
    }
  }

  private var ftpScope: ZoneScope { store.cyclingFTPScope }

  private var heartRateScope: ZoneScope { store.cyclingHeartRateScope }
}
