import RideData

extension RideSession {
  static let markedLapShownFor: Double = 3

  var justMarkedLap: Int? {
    let marks = lapMarks
    guard marks.count >= 2, marks[marks.count - 2].endedBy == .manual,
      marks[marks.count - 2].stepIndex == marks[marks.count - 1].stepIndex,
      elapsed - marks[marks.count - 1].start < Self.markedLapShownFor
    else { return nil }
    return marks.count
  }
}
