import AuthenticationServices
import RideData
import RideStrava
import SwiftUI

/// A finished ride: when it happened, the headline numbers, the effort over time, and zones.
struct ActivityDetailView: View {
  let ride: Ride
  var onRemove: () -> Void
  @State private var isExporting = false
  @State private var isConfirmingRemove = false
  /// Why the last export failed, while it is shown.
  @State private var exportError: String?
  /// How sending the ride to Strava ended, while it is shown.
  @State private var stravaOutcome: StravaOutcome?
  @State private var isSendingToStrava = false
  @Environment(RiderSettingsStore.self) private var store
  @Environment(StravaConnection.self) private var strava
  @Environment(\.webAuthenticationSession) private var webAuthenticationSession
  @Environment(\.openURL) private var openURL

  private var recording: RideRecording { ride.recording }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 22) {
        VStack(alignment: .leading, spacing: 4) {
          Text(
            "\(recording.startDate, format: .dateTime.weekday(.wide).day().month(.wide).year()) · \(recording.startDate, format: .dateTime.hour().minute())"
          )
          .foregroundStyle(.secondary)
          Text(ride.title).font(.largeTitle).bold()
        }
        RideStatsRow(stats: stats)
        if recording.hasPower || recording.hasHeartRate {
          ActivityChart(recording: recording)
        }
        RideBreakdownSection(recording: recording)
      }
      .pageLayout(maxWidth: Design.ridePageWidth, alignment: .center)
    }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        ShareLink(item: ride, preview: SharePreview(ride.title))
      }
      #if os(iOS)
        // Its actions join the system's own overflow menu rather than nesting in it.
        ToolbarOverflowMenu { moreActions }
      #else
        ToolbarItem {
          Menu("More", systemImage: "ellipsis") { moreActions }
        }
      #endif
    }
    // Attached outside the menu, which the system owns on iOS, so that it can present.
    .confirmationDialog("Remove this ride from History?", isPresented: $isConfirmingRemove) {
      Button("Remove Ride", role: .destructive, action: onRemove)
    } message: {
      Text("To get it back, open its FIT file again.")
    }
    .fileExporter(
      isPresented: $isExporting, document: FITDocument(data: ride.fileData),
      contentType: .fitFile, defaultFilename: ride.exportFileName
    ) { result in
      if case .failure(let error) = result { exportError = error.localizedDescription }
    }
    .alert("Couldn't export the ride", item: $exportError) { _ in
    } message: { error in
      Text(error)
    }
    .alert(
      stravaOutcome?.title ?? "", isPresented: stravaOutcomeShown, presenting: stravaOutcome
    ) { outcome in
      if let url = outcome.activityURL {
        Button("View on Strava") { openURL(url) }
      }
      Button("OK") {}
    } message: { outcome in
      Text(outcome.message)
    }
  }

  @ViewBuilder private var moreActions: some View {
    Button("Send to Strava", systemImage: "arrow.up.forward.app", action: sendToStrava)
      .disabled(isSendingToStrava)
    Button("Export FIT…", systemImage: "square.and.arrow.down", action: export)
    Divider()
    Button("Remove from History", systemImage: "trash", role: .destructive, action: confirmRemove)
  }

  private func export() { isExporting = true }

  private var stravaOutcomeShown: Binding<Bool> {
    Binding(get: { stravaOutcome != nil }, set: { if !$0 { stravaOutcome = nil } })
  }

  /// Sends the ride to Strava, signing the rider in first if they have not been.
  private func sendToStrava() {
    Task {
      isSendingToStrava = true
      defer { isSendingToStrava = false }
      do {
        if !strava.isConnected {
          try await strava.connect { url in
            try await webAuthenticationSession.authenticate(
              using: url, callback: .customScheme(StravaSignIn.callbackScheme),
              additionalHeaderFields: [:])
          }
        }
        stravaOutcome = .sent(try await strava.upload(ride).url)
      } catch StravaError.denied {
        // The rider backed out of signing in.
      } catch StravaError.duplicate(let activityID) {
        stravaOutcome = .alreadyThere(
          activityID.flatMap { URL(string: "https://www.strava.com/activities/\($0)") })
      } catch {
        stravaOutcome = .failed(error.localizedDescription)
      }
    }
  }

  private func confirmRemove() { isConfirmingRemove = true }

  private var stats: [RideStat] {
    let summary = recording.summary
    var result = [RideStat(label: "Duration", value: summary.duration.clockString)]
    if let power = summary.averagePower {
      result.append(.init(label: "Avg power", value: "\(power)", unit: "W"))
    }
    if let heartRate = summary.averageHeartRate {
      result.append(.init(label: "Avg heart rate", value: "\(heartRate)", unit: "bpm"))
    }
    if let ftp = store.ftp(for: recording), let stress = recording.trainingStressScore(ftp: ftp) {
      result.append(.init(label: "Stress", value: "\(stress)", unit: "TSS"))
    }
    if let onTarget = recording.timeOnTarget() {
      result.append(
        .init(label: "On target", value: "\(Int((onTarget * 100).rounded()))", unit: "%"))
    }
    if let distance = summary.distance {
      result.append(
        .init(
          label: "Distance",
          value: (distance / 1000).formatted(.number.precision(.fractionLength(1))), unit: "km"))
    }
    return result
  }
}

#Preview {
  NavigationStack {
    if let ride = RideLibrary.sample().rides.first {
      ActivityDetailView(ride: ride) {}
    }
  }
  .environment(RiderSettingsStore.sample)
  .environment(StravaConnection.sample)
  .frame(width: 800, height: 760)
}
