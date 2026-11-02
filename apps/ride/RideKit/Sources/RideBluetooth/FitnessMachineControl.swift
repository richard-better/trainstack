import Foundation

struct FitnessMachineControl: Sendable {
  static let responseTimeout: TimeInterval = 2
  static let refusalBackoff: TimeInterval = 5
  static let resetStatus: UInt8 = 0x01
  static let controlPermissionLostStatus: UInt8 = 0xFF
  static let statusesEndingControl: Set<UInt8> = [resetStatus, controlPermissionLostStatus]

  private enum State: Equatable {
    case awaitingIndications
    case released
    case refused(at: Date)
    case controlling(started: Bool)
  }

  private var state = State.awaitingIndications
  private var pending: (command: FitnessMachineCommand, target: TrainerTarget?, sent: Date)?
  private var target: TrainerTarget?
  private var lastAnsweredTarget: TrainerTarget?
  private var resistanceRange: FitnessMachineRange?
  private var powerRange: FitnessMachineRange?

  init(target: TrainerTarget? = nil) {
    self.target = target
  }

  mutating func becameReady(at date: Date) -> FitnessMachineCommand? {
    if state == .awaitingIndications { state = .released }
    return next(at: date)
  }

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
        response.requestOpCode == pending.command.opCode
      else { return nil }
      self.pending = nil
      handle(response.result, to: pending.command, target: pending.target, at: date)
    case .status:
      if let status = data.first, Self.statusesEndingControl.contains(status) { loseControl() }
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
      if result == .notPermitted {
        loseControl()
      } else {
        state = .controlling(started: true)
      }
    case .targetPower, .targetResistance, .simulation:
      if result == .notPermitted {
        loseControl()
      } else {
        lastAnsweredTarget = target
      }
    }
  }

  private mutating func loseControl() {
    if state != .awaitingIndications { state = .released }
    lastAnsweredTarget = nil
  }

  private mutating func next(at date: Date) -> FitnessMachineCommand? {
    if let pending {
      guard date.timeIntervalSince(pending.sent) >= Self.responseTimeout else { return nil }
      self.pending = nil
    }
    let command: FitnessMachineCommand?
    var sentTarget: TrainerTarget?
    switch state {
    case .awaitingIndications:
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
        } else if target != lastAnsweredTarget {
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
      return .targetPower(watts: powerRange?.nearest(Double(watts)) ?? watts)
    case .grade(let grade):
      return .simulation(gradePercent: grade)
    case .resistance(let share):
      guard let range = resistanceRange else { return nil }
      let level = range.nearest(
        Double(range.minimum) + share.clamped(to: 0...1) * Double(range.maximum - range.minimum))
      return .targetResistance(level: level, wide: range.needsTwoBytes)
    }
  }
}
