import Foundation

public struct SessionRunner: Codable, Sendable, Equatable {
  public enum Phase: String, Codable, Sendable { case exercise, rest, finished }
  public private(set) var exerciseIndex = 0
  public private(set) var set = 1
  public private(set) var isRightSide = false
  public private(set) var phase: Phase = .exercise
  public private(set) var remaining: TimeInterval = 0
  public private(set) var deadline: Date?
  public private(set) var skipped: Set<Int> = []
  public private(set) var completed: Set<Int> = []
  public let exercises: [SessionsGetByIdOutputExercisesItem]

  public init(
    exercises: [SessionsGetByIdOutputExercisesItem], resumeAfter: Int? = nil, skipped: Set<Int> = []
  ) {
    self.exercises = exercises
    if let resumeAfter, resumeAfter >= 0 {
      exerciseIndex = min(resumeAfter + 1, exercises.count)
      completed = Set(0..<exerciseIndex)
    }
    self.skipped = skipped.filter { exercises.indices.contains($0) }
    completed.subtract(self.skipped)
    prepare()
  }
  public var current: SessionsGetByIdOutputExercisesItem? {
    exercises.indices.contains(exerciseIndex) ? exercises[exerciseIndex] : nil
  }
  public var canComplete: Bool {
    !exercises.isEmpty && completed.count >= Int(ceil(Double(exercises.count) * 0.8))
  }
  public var isPaused: Bool { deadline == nil }
  public mutating func start(now: Date = .now) {
    if remaining > 0 { deadline = now.addingTimeInterval(remaining) }
  }
  public mutating func pause(now: Date = .now) {
    if let deadline { remaining = max(0, deadline.timeIntervalSince(now)) }
    deadline = nil
  }
  public mutating func tick(now: Date = .now) {
    guard let deadline else { return }
    remaining = max(0, deadline.timeIntervalSince(now))
    if remaining == 0 { advance(now: now) }
  }
  public mutating func skip() {
    guard current != nil else { return }
    skipped.insert(exerciseIndex)
    exerciseIndex += 1
    set = 1
    isRightSide = false
    prepare()
  }
  public mutating func advance(now: Date = .now) {
    defer { start(now: now) }
    guard let current else { return }
    deadline = nil
    if phase == .rest {
      phase = .exercise
      remaining = Double(current.durationSec ?? 0)
      return
    }
    if current.side == "left_right" && !isRightSide {
      isRightSide = true
      remaining = Double(current.durationSec ?? 0)
      return
    }
    isRightSide = false
    if set < current.sets {
      set += 1
      phase = current.restSec > 0 ? .rest : .exercise
      remaining = Double(current.restSec > 0 ? current.restSec : (current.durationSec ?? 0))
    } else {
      completed.insert(exerciseIndex)
      exerciseIndex += 1
      set = 1
      prepare()
    }
  }
  private mutating func prepare() {
    deadline = nil
    phase = current == nil ? .finished : .exercise
    remaining = Double(current?.durationSec ?? 0)
  }
}
