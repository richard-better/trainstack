import RideData
import Testing

@testable import RideUI

struct WorkoutsStateTests {
  /// 30 minutes easy, 60 at threshold and 90 at a mix, so each filter has something to drop.
  private let library = [
    WorkoutTemplate(
      name: "Spin", category: .recovery, steps: [.init(duration: 1800, intensity: 0.5)]),
    WorkoutTemplate(
      name: "Threshold", category: .threshold, steps: [.init(duration: 3600, intensity: 1)]),
    WorkoutTemplate(
      name: "Long mix", category: .endurance,
      steps: [.init(duration: 4800, intensity: 0.65), .init(duration: 600, intensity: 0.9)]),
  ]

  @Test func showsEverythingByNameWithoutFilters() {
    #expect(WorkoutsState().shown(in: library).map(\.name) == ["Long mix", "Spin", "Threshold"])
  }

  @Test func searchesNamesIgnoringCase() {
    var state = WorkoutsState()
    state.search = "thresh"
    #expect(state.shown(in: library).map(\.name) == ["Threshold"])
  }

  @Test func filtersByDurationZoneAndStress() {
    var state = WorkoutsState()
    state.duration = .short
    #expect(state.shown(in: library).map(\.name) == ["Spin"])

    state = WorkoutsState()
    state.zone = .endurance
    #expect(state.shown(in: library).map(\.name) == ["Long mix"])

    state = WorkoutsState()
    state.stress = .high
    #expect(state.shown(in: library).allSatisfy { $0.stressScore > 70 })
    #expect(!state.shown(in: library).contains { $0.name == "Spin" })
  }

  @Test func sortsByDurationThenName() {
    var state = WorkoutsState()
    state.order = .duration
    #expect(state.shown(in: library).map(\.name) == ["Spin", "Threshold", "Long mix"])
  }
}
