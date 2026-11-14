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
  private(set) var features: FitnessMachineFeatures?
  private(set) var spinDown: SpinDown?
  private var spinDownAskedAt: Date?

  init(target: TrainerTarget? = nil) {
    self.target = target
  }

  mutating func becameReady(at date: Date) -> FitnessMachineCommand? {
    if state == .awaitingIndications { state = .released }
    return next(at: date)
  }

  mutating func set(_ target: TrainerTarget?, at date: Date) -> FitnessMachineCommand? {
    self.target = target
    if target != nil, spinDown?.isUnderway == true { spinDown = .failed }
    return next(at: date)
  }

  mutating func startSpinDown(at date: Date) -> FitnessMachineCommand? {
    guard target == nil, spinDown?.isUnderway != true else { return nil }
    spinDown = features?.supportsSpinDown == false ? .unsupported : .starting
    spinDownAskedAt = date
    return next(at: date)
  }

  mutating func checkForTimeouts(at date: Date) -> FitnessMachineCommand? {
    next(at: date)
  }

  mutating func endSpinDown(at date: Date) -> FitnessMachineCommand? {
    spinDown = nil
    return next(at: date)
  }

  private var wantsControl: Bool { target != nil || spinDown?.isUnderway == true }

  mutating func receive(
    _ data: Data, from characteristic: TrainerCharacteristic, at date: Date
  ) -> FitnessMachineCommand? {
    switch characteristic {
    case .controlPoint:
      guard let response = FitnessMachineResponse(data), let pending,
        response.requestOpCode == pending.command.opCode
      else { return nil }
      self.pending = nil
      if pending.command == .startSpinDown {
        startedSpinDown(response)
      } else {
        handle(response.result, to: pending.command, target: pending.target, at: date)
      }
    case .status:
      if let status = data.first, Self.statusesEndingControl.contains(status) { loseControl() }
      if data.first == SpinDown.statusOpCode, data.count > 1 { spinDownStatus(data[1]) }
    case .feature:
      features = FitnessMachineFeatures(data)
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
      if result != .success, spinDown == .starting { spinDown = .failed }
    case .reset:
      loseControl()
    case .start:
      if result == .notPermitted {
        loseControl()
      } else {
        state = .controlling(started: true)
      }
    case .startSpinDown:
      break
    case .targetPower, .targetResistance, .simulation:
      if result == .notPermitted {
        loseControl()
      } else {
        lastAnsweredTarget = target
      }
    }
  }

  private mutating func startedSpinDown(_ response: FitnessMachineResponse) {
    guard spinDown == .starting else { return }
    switch response.result {
    case .success:
      var reader = BluetoothValueReader(response.parameter)
      let speeds = reader.uint16().flatMap { low in reader.uint16().map { (low, $0) } }
      spinDown = .speedUp(
        targetKilometresPerHour: speeds.flatMap { low, high in
          low <= high
            ? Double(low) * SpinDown.kilometresPerHourPerUnit...Double(high)
              * SpinDown.kilometresPerHourPerUnit : nil
        })
    case .notSupported:
      spinDown = .unsupported
    case .notPermitted:
      spinDown = .failed
      loseControl()
    case .invalidParameter, .failed:
      spinDown = .failed
    }
  }

  private mutating func spinDownStatus(_ status: UInt8) {
    guard spinDown?.isUnderway == true else { return }
    switch status {
    case SpinDown.stopPedallingStatus: spinDown = .stopPedalling
    case SpinDown.success: spinDown = .succeeded
    case SpinDown.error: spinDown = .failed
    default: break
    }
  }

  private mutating func loseControl() {
    if state != .awaitingIndications { state = .released }
    lastAnsweredTarget = nil
    if spinDown?.isUnderway == true { spinDown = .failed }
  }

  private mutating func next(at date: Date) -> FitnessMachineCommand? {
    if let pending {
      guard date.timeIntervalSince(pending.sent) >= Self.responseTimeout else { return nil }
      self.pending = nil
      if spinDown == .starting { spinDown = .failed }
    }
    if spinDown == .starting, state == .awaitingIndications, let spinDownAskedAt,
      date.timeIntervalSince(spinDownAskedAt) >= Self.responseTimeout
    {
      spinDown = .failed
    }
    let command: FitnessMachineCommand?
    var sentTarget: TrainerTarget?
    switch state {
    case .awaitingIndications:
      command = nil
    case .released:
      command = wantsControl ? .requestControl : nil
    case .refused(let at):
      guard wantsControl, date.timeIntervalSince(at) >= Self.refusalBackoff else { return nil }
      command = .requestControl
    case .controlling(let started):
      if spinDown?.isUnderway == true {
        command = spinDown == .starting ? .startSpinDown : nil
      } else if let target {
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
