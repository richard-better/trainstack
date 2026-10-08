#if os(watchOS)
  import RideLink
  import SwiftUI

  /// The watch app: a button to relay heart rate until a workout starts, then the ride, with the
  /// workout's controls a swipe away.
  public struct WatchRootView: View {
    @State private var relay = WorkoutRelay.shared
    @State private var page = Page.ride
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    private enum Page { case controls, ride }

    public init() {}

    public var body: some View {
      // Wrist down, the screen changes at most once a minute.
      TimelineView(.periodic(from: .now, by: isLuminanceReduced ? 60 : 1)) { context in
        let screen = WatchScreen(workout: relay.workout, glance: relay.glance, at: context.date)
        if screen == .idle {
          NavigationStack {
            IdleView(start: { relay.start(fromPhone: false) })
          }
        } else {
          TabView(selection: $page) {
            NavigationStack {
              ControlsView(end: relay.end)
            }
            .tag(Page.controls)
            NavigationStack {
              ScreenView(screen: screen, relay: relay)
                #if DEBUG
                  .environment(
                    \.isLuminanceReduced, isLuminanceReduced || WorkoutRelay.showsAlwaysOn)
                #endif
            }
            .tag(Page.ride)
          }
          .tabViewStyle(.page)
        }
      }
      .fontDesign(.rounded)
      .onChange(of: relay.workout == nil) { page = .ride }
      .task {
        #if DEBUG
          if let ride = WorkoutRelay.launchRide {
            relay.startLaunchRide(ride)
            return
          }
        #endif
        await relay.requestAuthorization()
      }
    }
  }

  /// The page that follows the workout.
  private struct ScreenView: View {
    let screen: WatchScreen
    let relay: WorkoutRelay

    var body: some View {
      switch screen {
      case .idle:
        EmptyView()
      case .starting(let count):
        StartingView(
          count: count, workoutName: relay.glance?.glance.workoutName, heartRate: relay.heartRate,
          isPhoneConnected: relay.isPhoneConnected)
      case .glance(let glance):
        GlanceView(glance: glance)
      case .intervalEnding(let glance, let seconds):
        IntervalEndingView(glance: glance, seconds: seconds)
      case .relaying:
        RelayingView(
          startDate: relay.workout?.startDate ?? .now, heartRate: relay.heartRate,
          isPhoneConnected: relay.isPhoneConnected)
      }
    }
  }
#endif
