#if DEBUG
  import Foundation
  import RideData
  import RideLink

  extension WorkoutRelay {
    /// Debug builds started with `-ride "<workout name>"` play that ride as if the phone were
    /// running it, with a pretend trainer and heart rate strap, so the watch can be tried
    /// without a phone. `-ride-minutes <minutes>` starts that far in. Nothing is recorded in
    /// Health.
    static var launchRide: WorkoutTemplate? {
      let arguments = CommandLine.arguments
      guard let flag = arguments.firstIndex(of: "-ride"), flag + 1 < arguments.count else {
        return nil
      }
      return WorkoutTemplate.named(arguments[flag + 1])
    }

    func startLaunchRide(_ template: WorkoutTemplate) {
      let arguments = CommandLine.arguments
      let minutes = arguments.firstIndex(of: "-ride-minutes").flatMap {
        $0 + 1 < arguments.count ? Double(arguments[$0 + 1]) : nil
      }
      simulateWorkout()
      let ftp = 250
      let zones = ZoneModel.standard(for: .heartRate, in: nil).flatMap {
        ZoneSet(model: $0, limits: $0.limits(from: [.maxHeartRate: 186]) ?? [])
      }
      var session = RideSession(workout: template.workout(ftp: ftp))
      var trainer = SimulatedTrainer()
      for _ in 0..<Int((minutes ?? 0) * 60) {
        session.advance(by: 1, reading: trainer.reading(for: session, after: 1))
      }
      Task {
        while workout != nil {
          session.advance(by: 1, reading: trainer.reading(for: session, after: 1))
          simulateHeartRate(session.latest.heartRate)
          receive(.glance(RideGlance(session: session, ftp: ftp, heartRateZones: zones)))
          try? await Task.sleep(for: .seconds(1))
        }
      }
    }

    /// Whether debug builds were started with `-always-on`, to show the screen as it looks
    /// wrist down.
    static var showsAlwaysOn: Bool { CommandLine.arguments.contains("-always-on") }
  }
#endif
