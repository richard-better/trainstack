import Foundation
import RideData

struct WorkoutTracePoint: Identifiable {
  let position: TimeInterval
  let sample: RideRecording.Sample
  let unbrokenRun: Int
  var id: TimeInterval { position }

  static let mostPointsBeforeThinning = 600

  static func trace(of samples: [RideSession.LiveSample]) -> [WorkoutTracePoint] {
    let stride = max(1, samples.count / mostPointsBeforeThinning)
    var points: [WorkoutTracePoint] = []
    var run = 0
    var previous: TimeInterval?
    for index in Swift.stride(from: 0, to: samples.count, by: stride) {
      let sample = samples[index]
      if let previous, sample.position - previous > Double(stride) * 2 + 1 { run += 1 }
      previous = sample.position
      points.append(.init(position: sample.position, sample: sample.sample, unbrokenRun: run))
    }
    return points
  }
}
