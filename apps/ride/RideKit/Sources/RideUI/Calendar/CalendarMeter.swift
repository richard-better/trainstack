struct CalendarMeter: Equatable {
  let done: Double
  let planned: Double
  let fill: Double
  let mark: Double?

  init(done: Double, planned: Double) {
    self.done = done
    self.planned = planned
    let scale = max(done, planned)
    guard scale > 0 else {
      fill = 0
      mark = nil
      return
    }
    fill = done / scale
    mark = planned > 0 && done > planned ? planned / scale : nil
  }
}
