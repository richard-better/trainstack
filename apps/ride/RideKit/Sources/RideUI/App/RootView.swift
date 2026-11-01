import RideBluetooth
import RideData
import RideStrava
import SwiftUI

public struct RootView: View {
  @State private var destination = RideLibrary.launchDestination()
  @State private var library = RideLibrary.launched
  @State private var settings = RiderSettingsStore.launchStore()
  @State private var launcher = RideLauncher.launchLauncher()
  @State private var account = TrainStackAccount.launchAccount()
  /// Where Back to app returns to from Settings.
  @State private var appDestination = AppDestination.today
  @State private var settingsPage = SettingsPage.zones(.all)
  @State private var settingsPath: [SettingsPage] = []
  // The tabs are rebuilt when Settings takes over the sidebar, so what the rider chose in them
  // is held here.
  @State private var today = TodayState()
  @State private var workouts = WorkoutsState()
  @State private var historySelection: Ride.ID?
  /// What Send Feedback attaches, from when it was opened; nil while it is closed.
  @State private var feedback: FeedbackContext?
  @State private var windowSize: CGSize?
  @Namespace private var player
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.scenePhase) private var scenePhase
  #endif

  public init() {}

  public var body: some View {
    Group {
      if destination == .settings && hasSidebar {
        // Settings takes over the sidebar, like drilling into System Settings.
        SettingsSplitView(page: $settingsPage, back: backToApp)
      } else {
        AppTabs(
          destination: $destination, today: $today, workouts: $workouts,
          historySelection: $historySelection, settingsPath: $settingsPath, library: library,
          player: player)
      }
    }
    .environment(\.sendFeedback, sendFeedback)
    .modifier(PlayerPresentation(launcher: launcher, library: library, namespace: player))
    .sheet(isPresented: feedbackShown) {
      if let feedback { FeedbackSheet(context: feedback) }
    }
    .onGeometryChange(for: CGSize.self, of: Self.windowSize) { windowSize = $0 }
    .environment(settings)
    .environment(launcher)
    .environment(launcher.devices)
    .environment(account)
    .focusedSceneValue(\.rideLauncher, launcher)
    .focusedSceneValue(\.sendFeedback, sendFeedback)
    .task {
      launcher.checkForInterruptedRide()
      launcher.devices.connectPaired()
      await account.restore()
    }
    .alert(
      "Pick Up Your Ride?", isPresented: interruptedShown, presenting: launcher.interrupted
    ) { _ in
      Button("Resume") {
        launcher.resumeInterrupted(
          heartRateZones: settings.heartRateZones, riderWeight: settings.weight)
      }
      Button("Save What I Rode") { launcher.saveInterrupted(to: library) }
      Button("Discard", role: .destructive, action: launcher.discardInterrupted)
    } message: { interrupted in
      Text(
        "\(interrupted.name) stopped after \(interrupted.state.elapsed.clockString) of riding. Resume it where you left off, or save what you rode."
      )
    }
    .alert("Couldn't Save the Ride", isPresented: storageProblemShown) {
      Button("OK") {}
    } message: {
      Text(library.storageProblem ?? "")
    }
    .onChange(of: settings.powerDisplay, initial: true) { _, powerDisplay in
      launcher.powerDisplay = powerDisplay
    }
    .onChange(of: destination) { _, destination in
      if destination != .settings { appDestination = destination }
    }
    #if os(iOS)
      .onChange(of: scenePhase, initial: true) { _, phase in
        // Rides that could not be saved to Health while the app was away.
        guard phase == .active else { return }
        Task { await HealthRides.shared.savePending(from: library) }
      }
    #endif
    #if DEBUG
      .task {
        launcher.startLaunchRide(
          ftp: settings.ftp, heartRateZones: settings.heartRateZones, riderWeight: settings.weight)
      }
    #endif
  }

  /// Whether the app has a sidebar for Settings to take over, rather than a tab bar.
  private var hasSidebar: Bool {
    #if os(iOS)
      sizeClass == .regular
    #else
      true
    #endif
  }

  private func backToApp() { destination = appDestination }

  /// The whole window, safe areas included, which is what the root view's geometry leaves out.
  nonisolated private static func windowSize(_ geometry: GeometryProxy) -> CGSize {
    let insets = geometry.safeAreaInsets
    return CGSize(
      width: geometry.size.width + insets.leading + insets.trailing,
      height: geometry.size.height + insets.top + insets.bottom)
  }

  /// Opens Send Feedback, for a signed-in rider only.
  private var sendFeedback: SendFeedbackAction? {
    guard account.isSignedIn else { return nil }
    return SendFeedbackAction {
      feedback = .current(screen: screenName, window: windowSize)
    }
  }

  /// What the rider is looking at, for feedback.
  private var screenName: String {
    if launcher.isPlayerPresented { return "the player" }
    return switch destination {
    case .today: "Today"
    case .workouts: "Workouts"
    case .history: "History"
    case .progress: "Progress"
    case .settings: "Settings"
    }
  }

  /// Shown while an interrupted ride waits; the buttons are what end it.
  private var interruptedShown: Binding<Bool> {
    Binding(get: { launcher.interrupted != nil }, set: { _ in })
  }

  private var feedbackShown: Binding<Bool> {
    Binding(
      get: { feedback != nil },
      set: { if !$0 { feedback = nil } })
  }

  private var storageProblemShown: Binding<Bool> {
    Binding(
      get: { library.storageProblem != nil },
      set: { if !$0 { library.storageProblem = nil } })
  }
}

#Preview {
  RootView()
}
