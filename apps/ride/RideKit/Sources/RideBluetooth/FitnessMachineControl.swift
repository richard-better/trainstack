import Foundation

/// Controls one connected FTMS trainer: asks for control, then keeps the trainer on the latest
/// target. Each call returns the command to write next, if any.
///
/// The trainer carries out one command at a time and answers each, so a new target waits for
/// the answer to the last command and only the latest one is sent. A command left unanswered
/// for `responseTimeout` is given up on, and the next call moves on.
struct FitnessMachineControl: Sendable {
  static let responseTimeout: TimeInterval = 2
  /// How long to wait before asking again for control the trainer refused, such as while
  /// another app holds it.
  static let refusalBackoff: TimeInterval = 5

  private enum State: Equatable {
    /// Indications on the control point are not on yet, so commands could not be answered.
    case unavailable
    case released
    case refused(at: Date)
    case controlling(started: Bool)
  }

  private var state = State.unavailable
  private var pending: (command: FitnessMachineCommand, target: TrainerTarget?, sent: Date)?
  private var target: TrainerTarget?
  /// The target the trainer last answered for. Rejected targets count, so they are not sent
  /// again and again.
  private var applied: TrainerTarget?
  private var resistanceRange: FitnessMachineRange?
  private var powerRange: FitnessMachineRange?

  /// The trainer will now answer control point writes.
  mutating func becameReady(at date: Date) -> FitnessMachineCommand? {
    if state == .unavailable { state = .released }
    return next(at: date)
  }

  /// Aims for `target`, or hands control back with nil.
  mutating func set(_ target: TrainerTarget?, at date: Date) -> FitnessMachineCommand? {
    self.target = target
    return next(at: date)
  }

  mutating func receive(
    _ data: Data, from characteristic: TrainerCharacteristic, at date: Date
  ) -> FitnessMachineCommand? {
    switch characteristic {
    case .controlPoint:
      guard let response = FitnessMachineResponse(data), let pending,
        response.opCode == pending.command.opCode
      else { return nil }
      self.pending = nil
      handle(response.result, to: pending.command, target: pending.target, at: date)
    case .status:
      // Reset, or Control Permission Lost: the trainer is no longer following Ride.
      if data.first == 0x01 || data.first == 0xFF { loseControl() }
    case .resistanceRange:
      resistanceRange = FitnessMachineRange(data)
    case .powerRange:
      powerRange = FitnessMachineRange(data)
    }
    return next(at: date)
  }

  private mutating func handle(
    _ result: FitnessMachineResponse.Result, to command: FitnessMachineCommand,
    target: TrainerTarget?, at date: Date
  ) {
    switch command {
    case .requestControl:
      state = result == .success ? .controlling(started: false) : .refused(at: date)
    case .reset:
      loseControl()
    case .start:
      // A trainer that is already running fails the start, and is ready all the same.
      if result == .notPermitted {
        loseControl()
      } else {
        state = .controlling(started: true)
      }
    case .targetPower, .targetResistance, .simulation:
      if result == .notPermitted {
        loseControl()
      } else {
        applied = target
      }
    }
  }

  private mutating func loseControl() {
    if state != .unavailable { state = .released }
    applied = nil
  }

  private mutating func next(at date: Date) -> FitnessMachineCommand? {
    if let pending {
      guard date.timeIntervalSince(pending.sent) >= Self.responseTimeout else { return nil }
      self.pending = nil
    }
    let command: FitnessMachineCommand?
    var sentTarget: TrainerTarget?
    switch state {
    case .unavailable:
      command = nil
    case .released:
      command = target == nil ? nil : .requestControl
    case .refused(let at):
      guard target != nil, date.timeIntervalSince(at) >= Self.refusalBackoff else { return nil }
      command = .requestControl
    case .controlling(let started):
      if let target {
        if !started {
          command = .start
        } else if target != applied {
          command = self.command(for: target)
          sentTarget = target
        } else {
          command = nil
        }
      } else {
        command = .reset
      }
    }
    if let command { pending = (command, sentTarget, date) }
    return command
  }

  private func command(for target: TrainerTarget) -> FitnessMachineCommand? {
    switch target {
    case .power(let watts):
      return .targetPower(powerRange?.nearest(Double(watts)) ?? watts)
    case .grade(let grade):
      return .simulation(grade: grade)
    case .resistance(let share):
      // A trainer that takes resistance targets has a range for them. Until it is read, wait.
      guard let range = resistanceRange else { return nil }
      let level = range.nearest(
        Double(range.minimum) + share.clamped(to: 0...1) * Double(range.maximum - range.minimum))
      return .targetResistance(level, wide: range.minimum < 0 || range.maximum > 255)
    }
  }
}
