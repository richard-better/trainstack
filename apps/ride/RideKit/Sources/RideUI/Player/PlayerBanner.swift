import RideData
import RideLink

struct PlayerBanner: Equatable {
  enum Kind { case lap, cue, upcoming }

  let kind: Kind
  let text: String

  var systemImage: String {
    switch kind {
    case .lap: "flag.fill"
    case .cue: "text.bubble"
    case .upcoming: "arrow.forward.circle"
    }
  }

  init(kind: Kind, text: String) {
    self.kind = kind
    self.text = text
  }

  static func shown(in session: RideSession, ftp: Int) -> [PlayerBanner] {
    [
      session.justMarkedLap.map { PlayerBanner(kind: .lap, text: "Lap \($0)") },
      session.cue.map { PlayerBanner(kind: .cue, text: $0.text) },
      upcoming(in: session, ftp: ftp).map { PlayerBanner(kind: .upcoming, text: $0) },
    ].compactMap(\.self)
  }

  private static func upcoming(in session: RideSession, ftp: Int) -> String? {
    guard let remaining = session.intervalRemaining, remaining <= IntervalCountdown.warning,
      let next = session.nextInterval
    else { return nil }
    let target: String? =
      if let watts = next.plannedPower(at: next.start) {
        "\(session.mode == .erg ? session.adjusted(watts) : watts) W"
      } else if case .heartRate(let heartRate) = next.step.target {
        StepTargetText.heartRate(heartRate).value + " "
          + StepTargetText.heartRate(heartRate).unit
      } else {
        nil
      }
    let length =
      next.step.endsOnLap ? "until you press lap" : "for \((next.end - next.start).clockString)"
    return (["Next: \(next.title(ftp: ftp))", target, length].compactMap(\.self))
      .joined(separator: " · ")
  }
}
