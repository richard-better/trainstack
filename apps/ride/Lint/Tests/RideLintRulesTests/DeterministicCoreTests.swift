import Testing

@testable import RideLintRules

struct DeterministicCoreTests {
  private let corePath = "RideKit/Sources/RideCore/RideEngine.swift"

  @Test func flagsClocksAndRandomnessInTheCore() {
    let source = """
      let started = Date()
      let today = Date.now
      let instant = ContinuousClock.now
      let roll = Int.random(in: 1...6)
      let id = UUID()
      try await Task.sleep(for: .seconds(1))
      func at(_ date: Date = .now) {}
      """
    let found = violations(of: DeterministicCore(), in: source, path: corePath)
    #expect(lines(found) == [1, 2, 3, 3, 4, 5, 6, 7])
  }

  @Test func allowsTimesAndSeedsPassedIn() {
    let source = """
      let start = Date(timeIntervalSince1970: 1_800_000_000)
      let id = UUID(uuidString: "E621E1F8-C36C-495A-93FC-0C247A3E6E5F")
      let later = start.addingTimeInterval(60)
      """
    #expect(violations(of: DeterministicCore(), in: source, path: corePath).isEmpty)
  }

  @Test func leavesCodeOutsideTheCoreAlone() {
    let source = "let started = Date.now"
    #expect(
      violations(
        of: DeterministicCore(), in: source,
        path: "RideKit/Sources/RideUI/Player/RideController.swift"
      ).isEmpty)
  }
}
