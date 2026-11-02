#if os(watchOS)
  import RideLink
  import SwiftUI

  public struct WatchRootView: View {
    @State private var relay = WorkoutRelay.shared
    @State private var page = Page.ride
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    private enum Page { case controls, ride }

    private static let wristDownRefreshInterval: TimeInterval = 60
    private static let wristUpRefreshInterval: TimeInterval = 1

    public init() {}

    public var body: some View {
      TimelineView(.periodic(from: .now, by: refreshInterval)) { context in
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
        await relay.requestAuthorizationBeforeTheFirstRide()
      }
    }

    private var refreshInterval: TimeInterval {
      isLuminanceReduced ? Self.wristDownRefreshInterval : Self.wristUpRefreshInterval
    }
  }

  private struct ScreenView: View {
    let screen: WatchScreen
    let relay: WorkoutRelay

    var body: some View {
      switch screen {
      case .idle:
        EmptyView()
      case .starting(let count):
        StartingView(
          count: count, workoutName: relay.glance?.glance.workoutName,
          heartRate: relay.measuredHeartRate,
          isPhoneConnected: relay.isPhoneConnected)
      case .glance(let glance):
        GlanceView(glance: glance)
      case .intervalEnding(let glance, let seconds):
        IntervalEndingView(glance: glance, seconds: seconds)
      case .relaying:
        RelayingView(
          startDate: relay.workout?.startDate ?? .now, heartRate: relay.measuredHeartRate,
          isPhoneConnected: relay.isPhoneConnected)
      }
    }
  }
#endif
