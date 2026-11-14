import RideData

extension WorkoutTemplate {
  public static let quickTest = WorkoutTemplate(
    name: "Quick test 45s", category: .vo2Max,
    steps: [
      .init(duration: 15, intensity: 0.5),
      .init(duration: 15, intensity: 0.75),
      .init(duration: 15, intensity: 1.2),
    ],
    about:
      "Fifteen seconds each at easy, medium and hard. Too short to train anything; it is here to check a trainer and the ride from start to finish.",
    cues: [.init(step: 0, text: "Easy"), .init(step: 1, text: "Medium"), .init(step: 2, text: "Hard")]
  )
}
