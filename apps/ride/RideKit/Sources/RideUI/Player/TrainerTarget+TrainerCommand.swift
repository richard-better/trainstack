import RideBluetooth
import RideCore

extension TrainerTarget {
  init(_ command: TrainerCommand) {
    switch command {
    case .power(let watts): self = .power(watts: watts)
    case .grade(let percent): self = .grade(percent: percent)
    case .resistance(let share): self = .resistance(shareOfRange: share)
    }
  }
}
