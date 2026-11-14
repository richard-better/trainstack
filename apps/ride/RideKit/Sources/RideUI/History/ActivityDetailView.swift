import RideData
import RideStrava
import SwiftUI

struct ActivityDetailView: View {
  let ride: Ride
  let library: RideLibrary
  var activity: AccountActivity?
  var isOnlyOnTheAccount = false
  var onRemove: () -> Void
  @State private var isExporting = false
  @State private var isConfirmingRemove = false
  @State private var exportError: String?
  @State private var stravaOutcome: StravaOutcome?
  @State private var isSendingToStrava = false
  @Environment(RiderSettingsStore.self) private var store
  @Environment(TrainstackAccount.self) private var account
  @Environment(RideLauncher.self) private var launcher
  @Environment(\.openURL) private var openURL
  @Environment(AccountHistory.self) private var history

  private var recording: RideRecording { ride.recording }

  private var title: String { activity?.title ?? ride.title }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 22) {
        VStack(alignment: .leading, spacing: 4) {
          Text(
            "\(recording.startDate, format: .dateTime.weekday(.wide).day().month(.wide).year()) · \(recording.startDate, format: .dateTime.hour().minute())"
          )
          .foregroundStyle(.secondary)
          Text(title).font(.largeTitle).bold()
          stravaStatus
        }
        if let template = recording.workoutName.flatMap(WorkoutTemplate.named) {
          RideWorkoutCard(template: template)
        }
        RideStatsRow(stats: stats)
        if recording.hasPower || recording.hasHeartRate {
          ActivityChart(recording: recording, ftp: store.ftp(for: recording))
        }
        if let activity { RouteSection(activity: activity) }
        RideBreakdownSection(recording: recording)
      }
      .pageLayout(maxWidth: Design.ridePageWidth, alignment: .center)
    }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        ShareLink(item: ride, preview: SharePreview(title))
      }
      #if os(iOS)
        ToolbarOverflowMenu { moreActions }
      #else
        ToolbarItem {
          Menu("More", systemImage: "ellipsis") { moreActions }
        }
      #endif
    }
    .task(id: activity) {
      if let activity { await history.loadDetailIfNeeded(of: activity) }
    }
    .confirmationDialog(
      isOnlyOnTheAccount ? "Delete this activity?" : "Remove this ride from History?",
      isPresented: $isConfirmingRemove
    ) {
      Button(
        isOnlyOnTheAccount ? "Delete Activity" : "Remove Ride", role: .destructive,
        action: onRemove)
    } message: {
      Text(
        isOnlyOnTheAccount
          ? AccountActivityDetailView.deletionMessage : "To get it back, open its FIT file again.")
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

  @ViewBuilder private var stravaStatus: some View {
    if isSendingToStrava {
      Label("Sending to Strava…", systemImage: "arrow.up.circle")
        .font(.subheadline).foregroundStyle(.secondary)
    } else if library.isOnStrava(ride) {
      if let url = library.stravaURL(of: ride) {
        Link(destination: url) {
          Label("On Strava", systemImage: "checkmark.circle.fill")
        }
        .font(.subheadline)
      } else {
        Label("On Strava", systemImage: "checkmark.circle.fill")
          .font(.subheadline).foregroundStyle(.secondary)
      }
    }
  }

  @ViewBuilder private var moreActions: some View {
    if library.isOnStrava(ride), let url = library.stravaURL(of: ride) {
      Button("View on Strava", systemImage: "arrow.up.forward.app") { openURL(url) }
    } else {
      Button(
        library.isOnStrava(ride) ? "Send to Strava Again" : "Send to Strava",
        systemImage: "arrow.up.forward.app", action: sendToStrava
      )
      .disabled(isSendingToStrava)
    }
    Button("Export FIT…", systemImage: "square.and.arrow.down", action: export)
    let traces = launcher.traces(of: ride)
    if !traces.isEmpty {
      ShareLink(items: traces) {
        Label("Share Ride Trace", systemImage: "waveform.path.ecg")
      }
    }
    Divider()
    Button(
      isOnlyOnTheAccount ? "Delete Activity" : "Remove from History", systemImage: "trash",
      role: .destructive, action: confirmRemove)
  }

  private func export() { isExporting = true }

  private var stravaOutcomeShown: Binding<Bool> {
    Binding(get: { stravaOutcome != nil }, set: { if !$0 { stravaOutcome = nil } })
  }

  private func sendToStrava() {
    Task {
      isSendingToStrava = true
      defer { isSendingToStrava = false }
      await account.restore()
      guard account.isSignedIn, account.isStravaConnected else {
        stravaOutcome = .failed(
          account.isSignedIn
            ? StravaError.notConnected.localizedDescription
            : StravaError.signedOut.localizedDescription)
        return
      }
      do {
        let url = try await account.upload(ride).url
        library.markOnStrava(ride, url: url)
        stravaOutcome = .sent(url)
      } catch StravaError.duplicate(let activityID) {
        let url = activityID.flatMap { URL(string: "https://www.strava.com/activities/\($0)") }
        library.markOnStrava(ride, url: url)
        stravaOutcome = .alreadyThere(url)
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
    if let distance = summary.distanceMetres {
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
    let library = RideLibrary.sample()
    if let ride = library.rides.first {
      ActivityDetailView(ride: ride, library: library) {}
    }
  }
  .environment(RiderSettingsStore.sample)
  .environment(TrainstackAccount.sample)
  .environment(RideLauncher(simulated: true))
  .environment(AccountHistory.preview)
  .frame(width: 800, height: 760)
}
