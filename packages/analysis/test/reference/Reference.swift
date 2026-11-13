import Foundation

struct Thresholds: Encodable {
  let ftp = 200
  let maxHeartRate = 190
  let thresholdPace = 130
}

struct CurvePoint: Encodable {
  let duration: Double
  let power: Int
}

struct ZoneSeconds: Encodable {
  let power: [Double]
  let heartRate: [Double]
  let pace: [Double]
}

struct Results: Encodable {
  let duration: Double
  let normalizedPower: Int?
  let intensityFactor: Double?
  let trainingStressScore: Int?
  let workKilojoules: Int?
  let powerCurve: [CurvePoint]
  let timeInZones: ZoneSeconds
}

struct Ride: Encodable {
  let file: String
  let samples: Int
  let results: Results
}

struct Synthetic: Encodable {
  let name: String
  let seed: UInt64
  let count: Int
  let steps: [Double]
  let results: Results
}

struct Day: Encodable {
  let day: Int
  let stress: Double
  let fitness: Double
  let fatigue: Double
  let form: Double
}

struct TrainingLoadReference: Encodable {
  let stress: [String: Double]
  let from: Int
  let through: Int
  let days: [Day]
}

struct Reference: Encodable {
  let thresholds: Thresholds
  let rides: [Ride]
  let synthetic: [Synthetic]
  let trainingLoad: TrainingLoadReference
}

struct Random {
  var state: UInt64
  mutating func next(_ bound: Int) -> Int {
    state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
    return Int((state >> 33) % UInt64(bound))
  }
}

@main enum ReferenceValues {
  static let thresholds = Thresholds()

  static func zones(_ metric: Threshold, _ value: Int, _ model: ZoneModel) -> ZoneSet {
    MetricZones(thresholds: [metric: value], choice: ZoneChoice(model: model)).zones!
  }

  static func results(_ recording: RideRecording) -> Results {
    var running = recording
    running.sport = .running
    let power = zones(.ftp, thresholds.ftp, .coggan6)
    let heartRate = zones(.maxHeartRate, thresholds.maxHeartRate, .percentOfMax)
    let pace = zones(.thresholdPace, thresholds.thresholdPace, .frielRunningPace)
    return Results(
      duration: recording.summary.duration,
      normalizedPower: recording.normalizedPower(),
      intensityFactor: recording.intensityFactor(ftp: thresholds.ftp),
      trainingStressScore: recording.trainingStressScore(ftp: thresholds.ftp),
      workKilojoules: recording.workKilojoules(),
      powerCurve: recording.powerCurve().map { CurvePoint(duration: $0.duration, power: $0.power) },
      timeInZones: ZoneSeconds(
        power: recording.timeInZones(power, of: .power).map(\.seconds),
        heartRate: recording.timeInZones(heartRate, of: .heartRate).map(\.seconds),
        pace: running.timeInZones(pace, of: .pace).map(\.seconds)))
  }

  static func synthetic(name: String, seed: UInt64, count: Int, steps: [Double]) -> Synthetic {
    var random = Random(state: seed)
    var elapsed = 0.0
    var samples: [RideRecording.Sample] = []
    for _ in 0..<count {
      let power = random.next(10) == 0 ? nil : 80 + random.next(400)
      let heartRate = random.next(12) == 0 ? nil : 90 + random.next(100)
      let speed = random.next(15) == 0 ? nil : 5.5 + Double(random.next(4500)) / 1000
      samples.append(
        .init(elapsed: elapsed, power: power, heartRate: heartRate, speedMetresPerSecond: speed))
      elapsed += steps[random.next(steps.count)]
    }
    let recording = RideRecording(
      startDate: Date(timeIntervalSince1970: 0), samples: samples,
      summary: .init(duration: samples.last?.elapsed ?? 0))
    return Synthetic(
      name: name, seed: seed, count: count, steps: steps, results: results(recording))
  }

  static func trainingLoad() -> TrainingLoadReference {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .gmt
    let start = Date(timeIntervalSince1970: 1_767_225_600)
    func day(_ offset: Int) -> Date { calendar.date(byAdding: .day, value: offset, to: start)! }
    var random = Random(state: 42)
    var stress: [Int: Double] = [:]
    for offset in 0..<90 where random.next(3) != 0 {
      stress[offset] = Double(random.next(2500)) / 10
    }
    let from = -5
    let through = 120
    let days = TrainingLoad.daily(
      stress: Dictionary(uniqueKeysWithValues: stress.map { (day($0.key), $0.value) }),
      from: day(from), through: day(through), calendar: calendar)
    return TrainingLoadReference(
      stress: Dictionary(uniqueKeysWithValues: stress.map { (String($0.key), $0.value) }),
      from: from, through: through,
      days: days.enumerated().map { index, load in
        Day(
          day: from + index, stress: load.stress, fitness: load.fitness, fatigue: load.fatigue,
          form: load.form)
      })
  }

  static func main() throws {
    let arguments = CommandLine.arguments.dropFirst()
    let rides = try arguments.map { path in
      let recording = try FITDecoder.decode(Data(contentsOf: URL(fileURLWithPath: path)))
      return Ride(
        file: URL(fileURLWithPath: path).lastPathComponent, samples: recording.samples.count,
        results: results(recording))
    }
    let reference = Reference(
      thresholds: thresholds,
      rides: rides,
      synthetic: [
        synthetic(name: "steady 1 Hz", seed: 1, count: 4000, steps: [1]),
        synthetic(
          name: "irregular with pauses", seed: 2, count: 4000,
          steps: [0.5, 1, 1, 1, 2, 3, 5, 6, 30]),
        synthetic(name: "half-second steps", seed: 3, count: 3000, steps: [0.5, 0.25, 0.75]),
        synthetic(name: "too short", seed: 4, count: 20, steps: [1]),
      ],
      trainingLoad: trainingLoad())
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    FileHandle.standardOutput.write(try encoder.encode(reference))
  }
}
