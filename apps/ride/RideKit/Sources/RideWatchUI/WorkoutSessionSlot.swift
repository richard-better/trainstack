struct WorkoutSessionSlot<Session: AnyObject> {
  private(set) var session: Session?

  var isEmpty: Bool { session == nil }

  func holds(_ candidate: Session?) -> Bool {
    guard let candidate else { return false }
    return session === candidate
  }

  mutating func take(_ started: Session) -> Bool {
    guard isEmpty else { return false }
    session = started
    return true
  }

  mutating func empty() {
    session = nil
  }
}
