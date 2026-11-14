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

  init?(session: RideSession, ftp: Int) {
    if let lap = session.justMarkedLap {
      self.init(kind: .lap, text: "Lap \(lap)")
    } else if let cue = session.cue {
      self.init(kind: .cue, text: cue.text)
    } else if let next = Self.upcoming(in: session, ftp: ftp) {
      self.init(kind: .upcoming, text: next)
    } else {
      return nil
    }
  }

  private static func upcoming(in session: RideSession, ftp: Int) -> String? {
    guard let remaining = session.intervalRemaining, remaining <= IntervalCountdown.warning,
      let next = session.nextInterval
    else { return nil }
    let target: String? =
      if session.mode == .erg, let watts = next.plannedPower(at: next.start) {
        "\(session.adjusted(watts)) W"
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
